param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\diagnostics\reveal-manager-probe.txt')
)

$ErrorActionPreference = 'Stop'

# This helper deliberately imports no process-write API.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class CareerLensReadOnlyMemory {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ReadProcessMemory(
        IntPtr process,
        IntPtr address,
        [Out] byte[] buffer,
        UIntPtr size,
        out UIntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@

function Read-RemoteBytes {
    param([IntPtr]$Handle, [UInt64]$Address, [int]$Count)

    $buffer = [byte[]]::new($Count)
    $read = [UIntPtr]::Zero
    $ok = [CareerLensReadOnlyMemory]::ReadProcessMemory(
        $Handle,
        [IntPtr]::new([Int64]$Address),
        $buffer,
        [UIntPtr]::new([UInt64]$Count),
        [ref]$read)
    if (-not $ok -or $read.ToUInt64() -ne [UInt64]$Count) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw ('ReadProcessMemory failed at 0x{0:X} ({1}/{2} bytes, error {3})' -f $Address, $read.ToUInt64(), $Count, $code)
    }
    return $buffer
}

function Read-RemoteUInt64 {
    param([IntPtr]$Handle, [UInt64]$Address)
    return [BitConverter]::ToUInt64((Read-RemoteBytes $Handle $Address 8), 0)
}

function Find-PatternInSection {
    param(
        [IO.FileStream]$Stream,
        [UInt32]$RawOffset,
        [UInt32]$RawSize,
        [byte[]]$Pattern,
        [bool[]]$Mask
    )

    $chunkSize = 4MB
    $overlap = $Pattern.Length - 1
    $position = [UInt64]$RawOffset
    $remaining = [UInt64]$RawSize
    $tail = [byte[]]::new(0)

    while ($remaining -gt 0) {
        $take = [int][Math]::Min([UInt64]$chunkSize, $remaining)
        $chunk = [byte[]]::new($take)
        $Stream.Position = [Int64]$position
        $actual = $Stream.Read($chunk, 0, $take)
        if ($actual -le 0) { break }
        if ($actual -ne $take) { [Array]::Resize([ref]$chunk, $actual) }

        $data = [byte[]]::new($tail.Length + $chunk.Length)
        if ($tail.Length) { [Array]::Copy($tail, 0, $data, 0, $tail.Length) }
        [Array]::Copy($chunk, 0, $data, $tail.Length, $chunk.Length)

        $index = 0
        while ($index -le $data.Length - $Pattern.Length) {
            $index = [Array]::IndexOf($data, $Pattern[0], $index)
            if ($index -lt 0 -or $index -gt $data.Length - $Pattern.Length) { break }
            $matches = $true
            for ($patternIndex = 0; $patternIndex -lt $Pattern.Length; $patternIndex++) {
                if ($Mask[$patternIndex] -and $data[$index + $patternIndex] -ne $Pattern[$patternIndex]) {
                    $matches = $false
                    break
                }
            }
            if ($matches) {
                return [UInt64]$position - [UInt64]$tail.Length + [UInt64]$index
            }
            $index++
        }

        $tailLength = [Math]::Min($overlap, $data.Length)
        $tail = [byte[]]::new($tailLength)
        [Array]::Copy($data, $data.Length - $tailLength, $tail, 0, $tailLength)
        $position += [UInt64]$actual
        $remaining -= [UInt64]$actual
    }
    return $null
}

function Find-RemotePattern {
    param(
        [IntPtr]$Handle,
        [UInt64]$StartAddress,
        [UInt64]$Size,
        [byte[]]$Pattern,
        [bool[]]$Mask
    )

    $chunkSize = 4MB
    $overlap = $Pattern.Length - 1
    $position = [UInt64]0
    $tail = [byte[]]::new(0)
    while ($position -lt $Size) {
        $take = [int][Math]::Min([UInt64]$chunkSize, $Size - $position)
        try {
            $chunk = Read-RemoteBytes $Handle ($StartAddress + $position) $take
        }
        catch {
            # Some packed sections have unreadable padding. Advance by a page.
            $position += [UInt64]0x1000
            $tail = [byte[]]::new(0)
            continue
        }
        $data = [byte[]]::new($tail.Length + $chunk.Length)
        if ($tail.Length) { [Array]::Copy($tail, 0, $data, 0, $tail.Length) }
        [Array]::Copy($chunk, 0, $data, $tail.Length, $chunk.Length)

        $index = 0
        while ($index -le $data.Length - $Pattern.Length) {
            $index = [Array]::IndexOf($data, $Pattern[0], $index)
            if ($index -lt 0 -or $index -gt $data.Length - $Pattern.Length) { break }
            $matches = $true
            for ($patternIndex = 0; $patternIndex -lt $Pattern.Length; $patternIndex++) {
                if ($Mask[$patternIndex] -and $data[$index + $patternIndex] -ne $Pattern[$patternIndex]) {
                    $matches = $false
                    break
                }
            }
            if ($matches) {
                return $StartAddress + $position - [UInt64]$tail.Length + [UInt64]$index
            }
            $index++
        }
        $tailLength = [Math]::Min($overlap, $data.Length)
        $tail = [byte[]]::new($tailLength)
        [Array]::Copy($data, $data.Length - $tailLength, $tail, 0, $tailLength)
        $position += [UInt64]$take
    }
    return $null
}

function Format-HexDump {
    param([byte[]]$Bytes, [UInt64]$BaseAddress)
    $lines = [Collections.Generic.List[string]]::new()
    for ($offset = 0; $offset -lt $Bytes.Length; $offset += 16) {
        $count = [Math]::Min(16, $Bytes.Length - $offset)
        $hex = (($Bytes[$offset..($offset + $count - 1)] | ForEach-Object { $_.ToString('X2') }) -join ' ')
        $lines.Add(('0x{0:X16}  {1}' -f ($BaseAddress + [UInt64]$offset), $hex))
    }
    return $lines
}

$process = Get-Process -Name FIFA22 -ErrorAction Stop | Select-Object -First 1
$module = $process.Modules | Where-Object ModuleName -eq 'FIFA22.exe' | Select-Object -First 1
if (-not $module) { throw 'FIFA22.exe module was not found.' }

$stream = [IO.File]::Open($module.FileName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$reader = [IO.BinaryReader]::new($stream)
try {
    $stream.Position = 0x3C
    $peOffset = $reader.ReadInt32()
    $stream.Position = $peOffset + 6
    $sectionCount = $reader.ReadUInt16()
    $stream.Position = $peOffset + 20
    $optionalHeaderSize = $reader.ReadUInt16()
    $sectionTable = $peOffset + 24 + $optionalHeaderSize

    $executableSections = [Collections.Generic.List[object]]::new()
    for ($sectionIndex = 0; $sectionIndex -lt $sectionCount; $sectionIndex++) {
        $stream.Position = $sectionTable + ($sectionIndex * 40)
        $name = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(8)).Trim([char]0)
        $virtualSize = $reader.ReadUInt32()
        $virtualAddress = $reader.ReadUInt32()
        $rawSize = $reader.ReadUInt32()
        $rawOffset = $reader.ReadUInt32()
        $stream.Position += 16
        $characteristics = $reader.ReadUInt32()
        if (($characteristics -band 0x20000000) -ne 0) {
            $executableSections.Add([pscustomobject]@{
                Name = $name
                VirtualSize = $virtualSize
                VirtualAddress = $virtualAddress
                RawSize = $rawSize
                RawOffset = $rawOffset
            })
        }
    }
    if ($executableSections.Count -eq 0) { throw 'No executable FIFA22.exe sections were found.' }

}
finally {
    $reader.Dispose()
    $stream.Dispose()
}

$handle = [CareerLensReadOnlyMemory]::OpenProcess(0x0410, $false, $process.Id)
if ($handle -eq [IntPtr]::Zero) {
    throw ('Unable to open FIFA22.exe read-only (error {0}).' -f [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}

try {
    $pattern = [byte[]](0x4C,0x89,0x3D,0,0,0,0,0x48,0x89,0x3D,0,0,0,0,0xEB,0x03,0x48,0x8B,0xC3)
    $mask = [bool[]]($true,$true,$true,$false,$false,$false,$false,$true,$true,$true,$false,$false,$false,$false,$true,$true,$true,$true,$true)
    $matchAddress = $null
    foreach ($section in $executableSections) {
        $candidate = Find-RemotePattern $handle ([UInt64]$module.BaseAddress.ToInt64() + [UInt64]$section.VirtualAddress) ([UInt64]$section.VirtualSize) $pattern $mask
        if ($null -ne $candidate) {
            $matchAddress = $candidate
            break
        }
    }
    if ($null -eq $matchAddress) { throw 'The FIFA 22 mode-manager signature was not found in executable memory.' }

    $instruction = Read-RemoteBytes $handle $matchAddress 19
    $displacement = [BitConverter]::ToInt32($instruction, 3)
    $globalSlot = [UInt64]([Int64]$matchAddress + 7 + $displacement)
    $modeManagers = Read-RemoteUInt64 $handle $globalSlot
    $revealWrapper = Read-RemoteUInt64 $handle ($modeManagers + 0x8F8)
    $revealManager = Read-RemoteUInt64 $handle $revealWrapper
    $transferWrapper = Read-RemoteUInt64 $handle ($modeManagers + 0xF18)
    $transferManager = Read-RemoteUInt64 $handle $transferWrapper
    if ($revealManager -eq 0) { throw 'PlayerDataRevealManager is null; make sure a Manager Career is loaded.' }

    $snapshot = Read-RemoteBytes $handle $revealManager 0x1000
    $pointerCandidates = [Collections.Generic.List[string]]::new()
    for ($offset = 0; $offset -le $snapshot.Length - 8; $offset += 8) {
        $value = [BitConverter]::ToUInt64($snapshot, $offset)
        if ($value -ge 0x10000 -and $value -le 0x00007FFFFFFFFFFF) {
            $pointerCandidates.Add(('+0x{0:X3} -> 0x{1:X16}' -f $offset, $value))
        }
    }

    $playerNames = @{}
    $exportPath = Join-Path $env:TEMP 'career-lens-player-export.csv'
    if (Test-Path -LiteralPath $exportPath) {
        foreach ($player in (Import-Csv -LiteralPath $exportPath)) {
            $playerNames[[UInt32]$player.playerid] = $player.name
        }
    }
    $vectorFindings = [Collections.Generic.List[string]]::new()
    for ($offset = 0; $offset -le $snapshot.Length - 24; $offset += 8) {
        $begin = [BitConverter]::ToUInt64($snapshot, $offset)
        $end = [BitConverter]::ToUInt64($snapshot, $offset + 8)
        $capacity = [BitConverter]::ToUInt64($snapshot, $offset + 16)
        if ($begin -lt 0x10000 -or $begin -gt 0x00007FFFFFFFFFFF) { continue }
        if ($end -lt $begin -or $capacity -lt $end) { continue }
        if (($capacity - $begin) -gt 16MB -or ($end - $begin) -gt 4MB) { continue }

        $length = [int]($end - $begin)
        $vectorFindings.Add(('+0x{0:X3} begin=0x{1:X16} length=0x{2:X} capacity=0x{3:X}' -f $offset, $begin, $length, ($capacity - $begin)))
        if ($length -lt 4) { continue }
        try { $vectorBytes = Read-RemoteBytes $handle $begin $length } catch {
            $vectorFindings.Add(('  unreadable: {0}' -f $_.Exception.Message))
            continue
        }
        if ($length -ge 20 -and ($length % 20) -eq 0) {
            $vectorFindings.Add(('  records20={0}' -f ($length / 20)))
            for ($recordOffset = 0; $recordOffset -le $vectorBytes.Length - 20; $recordOffset += 20) {
                $fields = 0..4 | ForEach-Object { [BitConverter]::ToUInt32($vectorBytes, $recordOffset + ($_ * 4)) }
                $recordName = if ($playerNames.ContainsKey($fields[0])) { $playerNames[$fields[0]] } else { '?' }
                $vectorFindings.Add(('  rec +0x{0:X4}: {1},{2},{3},{4},{5} name={6}' -f $recordOffset, $fields[0], $fields[1], $fields[2], $fields[3], $fields[4], $recordName))
            }
        }
        $matchCount = 0
        for ($vectorOffset = 0; $vectorOffset -le $vectorBytes.Length - 4; $vectorOffset += 4) {
            $id = [BitConverter]::ToUInt32($vectorBytes, $vectorOffset)
            if ($playerNames.ContainsKey($id)) {
                $vectorFindings.Add(('  +0x{0:X4} playerid={1} name={2}' -f $vectorOffset, $id, $playerNames[$id]))
                $matchCount++
                if ($matchCount -ge 100) {
                    $vectorFindings.Add('  match output capped at 100')
                    break
                }
            }
        }
        if ($matchCount -eq 0) { $vectorFindings.Add('  no aligned player IDs') }
    }

    $transferFindings = [Collections.Generic.List[string]]::new()
    if ($transferManager -ne 0) {
        $transferSnapshot = Read-RemoteBytes $handle $transferManager 0x4000
        $targetPlayerId = [UInt32]256903
        for ($offset = 0; $offset -le $transferSnapshot.Length - 4; $offset += 4) {
            if ([BitConverter]::ToUInt32($transferSnapshot, $offset) -eq $targetPlayerId) {
                $transferFindings.Add(('direct +0x{0:X4} playerid={1}' -f $offset, $targetPlayerId))
            }
        }
        $seenTransferVectors = @{}
        $transferVectorCount = 0
        for ($offset = 0; $offset -le $transferSnapshot.Length - 24; $offset += 8) {
            $begin = [BitConverter]::ToUInt64($transferSnapshot, $offset)
            $end = [BitConverter]::ToUInt64($transferSnapshot, $offset + 8)
            $capacity = [BitConverter]::ToUInt64($transferSnapshot, $offset + 16)
            if ($begin -lt 0x10000 -or $begin -gt 0x00007FFFFFFFFFFF) { continue }
            if ($end -lt $begin -or $capacity -lt $end) { continue }
            if (($capacity - $begin) -gt 4MB -or ($end - $begin) -gt 512KB) { continue }
            $length = [int]($end - $begin)
            if ($length -lt 4) { continue }
            $vectorKey = '{0:X16}:{1:X16}' -f $begin, $end
            if ($seenTransferVectors.ContainsKey($vectorKey)) { continue }
            $seenTransferVectors[$vectorKey] = $true
            $transferVectorCount++
            if ($transferVectorCount -gt 128) { break }
            try { $buffer = Read-RemoteBytes $handle $begin $length } catch { continue }
            for ($bufferOffset = 0; $bufferOffset -le $buffer.Length - 4; $bufferOffset += 4) {
                if ([BitConverter]::ToUInt32($buffer, $bufferOffset) -eq $targetPlayerId) {
                    $transferFindings.Add(('vector +0x{0:X4} begin=0x{1:X16} length=0x{2:X} hit=+0x{3:X}' -f $offset, $begin, $length, $bufferOffset))
                }
            }
        }
    }

    $report = [Collections.Generic.List[string]]::new()
    $report.Add('Career Lens read-only PlayerDataRevealManager probe')
    $report.Add(('timestamp={0:o}' -f [DateTimeOffset]::Now))
    $report.Add(('pid={0}' -f $process.Id))
    $report.Add(('module_base=0x{0:X16}' -f [UInt64]$module.BaseAddress.ToInt64()))
    $report.Add(('signature=0x{0:X16}' -f $matchAddress))
    $report.Add(('global_slot=0x{0:X16}' -f $globalSlot))
    $report.Add(('mode_managers=0x{0:X16}' -f $modeManagers))
    $report.Add(('reveal_wrapper=0x{0:X16}' -f $revealWrapper))
    $report.Add(('reveal_manager=0x{0:X16}' -f $revealManager))
    $report.Add(('transfer_wrapper=0x{0:X16}' -f $transferWrapper))
    $report.Add(('transfer_manager=0x{0:X16}' -f $transferManager))
    $report.Add('')
    $report.Add('[pointer-like qwords in first 0x1000 bytes]')
    $report.AddRange([string[]]$pointerCandidates)
    $report.Add('')
    $report.Add('[bounded vector-like triples and player-id matches]')
    $report.AddRange([string[]]$vectorFindings)
    $report.Add('')
    $report.Add('[hex dump]')
    $report.AddRange([string[]](Format-HexDump $snapshot $revealManager))
    $report.Add('')
    $report.Add('[TransferManager shortlist target findings]')
    if ($transferFindings.Count) { $report.AddRange([string[]]$transferFindings) } else { $report.Add('none') }

    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolvedOutput)) | Out-Null
    [IO.File]::WriteAllLines($resolvedOutput, $report, [Text.UTF8Encoding]::new($false))
    Write-Output ('PROBE_OK:{0}' -f $resolvedOutput)
    Write-Output ('REVEAL_MANAGER:0x{0:X16}' -f $revealManager)
    Write-Output ('POINTER_CANDIDATES:{0}' -f $pointerCandidates.Count)
}
finally {
    [CareerLensReadOnlyMemory]::CloseHandle($handle) | Out-Null
}
