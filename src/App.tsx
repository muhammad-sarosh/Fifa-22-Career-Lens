import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, Download, Eye, EyeOff, FolderOpen, Lock, ListOrdered, ListX, Plus, RefreshCw, Search, Settings, TableProperties, Trash2, Unlock, Users, X } from 'lucide-react'
import { parsePlayerCsv } from './csv'
import { listCareerSaves, pickCareerSave, readCareerSave, saveMarkdownExport } from './saves'
import { attributeGroups, attributeLabels, defaultPresets, fifaRatingBand, formatMoney, formatRating, midpoint, scoreForPreset } from './scoring'
import { allRolePresets, rolePresets } from './roles'
import { buildComparisonMarkdown } from './comparisonExport'
import { averageRating, summaryCategories } from './summary'
import { playerMatchesPositions, playerMatchesSearch } from './search'
import { attributeKeys, type AttributeKey, type CareerSave, type Player, type PositionPreset, type PresetId, type RatingRange } from './types'
import './styles.css'

type View = 'database' | 'compare'
type ValueIntent = 'neutral' | 'buying' | 'selling'
type Filters = { positions: string[]; scope: string; knowledge: string }
type PresetMap = Record<string, PositionPreset>

const blankFilters: Filters = { positions: [], scope: 'All', knowledge: 'All' }
const fifaDetailGroups: { name: string; stats: { key: AttributeKey; label: string }[] }[] = [
  { name: 'Physical', stats: [
    { key: 'acceleration', label: 'Acceleration' }, { key: 'sprintSpeed', label: 'Sprint Speed' },
    { key: 'agility', label: 'Agility' }, { key: 'balance', label: 'Balance' },
    { key: 'jumping', label: 'Jumping' }, { key: 'stamina', label: 'Stamina' },
    { key: 'strength', label: 'Strength' }, { key: 'reactions', label: 'Reactions' },
  ] },
  { name: 'Mental', stats: [
    { key: 'aggression', label: 'Aggression' }, { key: 'composure', label: 'Composure' },
    { key: 'interceptions', label: 'Interceptions' }, { key: 'attackingPosition', label: 'Att. Position' },
    { key: 'vision', label: 'Vision' },
  ] },
  { name: 'Technical', stats: [
    { key: 'ballControl', label: 'Ball Control' }, { key: 'crossing', label: 'Crossing' },
    { key: 'dribbling', label: 'Dribbling' }, { key: 'finishing', label: 'Finishing' },
    { key: 'freeKickAccuracy', label: 'FK Acc.' }, { key: 'headingAccuracy', label: 'Heading Acc.' },
    { key: 'longPassing', label: 'Long Pass' }, { key: 'shortPassing', label: 'Short Pass' },
    { key: 'marking', label: 'Def. Aware' }, { key: 'shotPower', label: 'Shot Power' },
    { key: 'longShots', label: 'Long Shots' }, { key: 'standingTackle', label: 'Stand Tackle' },
    { key: 'slidingTackle', label: 'Slide Tackle' }, { key: 'volleys', label: 'Volleys' },
    { key: 'curve', label: 'Curve' }, { key: 'penalties', label: 'Penalties' },
  ] },
  { name: 'Goalkeeping', stats: [
    { key: 'gkDiving', label: 'GK Diving' }, { key: 'gkHandling', label: 'GK Handling' },
    { key: 'gkKicking', label: 'GK Kicking' }, { key: 'gkPositioning', label: 'GK Positioning' },
    { key: 'gkReflexes', label: 'GK Reflexes' },
  ] },
]
const savedPresetsKey = 'career-lens-presets-v4'
const lastSaveKey = 'career-lens-last-save-v1'
const presetIds = Object.keys(defaultPresets) as PresetId[]
const isPresetId = (value: unknown): value is PresetId => typeof value === 'string' && presetIds.includes(value as PresetId)
const isCustomPreset = (preset: PositionPreset) => preset.id.startsWith('CUSTOM_')

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand('copy')
  area.remove()
  if (!copied) throw new Error('Clipboard access is unavailable')
}
function factoryPresetMap(): PresetMap {
  return Object.fromEntries([...Object.values(defaultPresets), ...allRolePresets].map((preset) => [preset.id, preset]))
}

function clonePresetMap(source: PresetMap = factoryPresetMap()): PresetMap {
  return Object.fromEntries(Object.entries(source).map(([id, preset]) => [id, { ...preset, weights: { ...preset.weights } }])) as PresetMap
}

function loadSavedPresets(): PresetMap {
  const result = clonePresetMap(factoryPresetMap())
  try {
    const saved = JSON.parse(localStorage.getItem(savedPresetsKey) ?? '{}') as Partial<Record<string, PositionPreset>>
    for (const [id, savedPreset] of Object.entries(saved)) {
      if (!savedPreset) continue
      if (!result[id] && isPresetId(savedPreset.position) && typeof savedPreset.name === 'string' && id.startsWith('CUSTOM_')) {
        result[id] = { id, name: savedPreset.name, position: savedPreset.position, description: typeof savedPreset.description === 'string' ? savedPreset.description : '', weights: {} }
      }
      if (!result[id]) continue
      for (const key of attributeKeys) {
        const value = Number(savedPreset.weights?.[key])
        if (Number.isFinite(value)) result[id].weights[key] = Math.max(0, Math.min(10, value))
      }
    }
  } catch { /* Keep factory presets. */ }
  return result
}

function App() {
  const initialPresets = useMemo(loadSavedPresets, [])
  const [view, setView] = useState<View>('database')
  const [saves, setSaves] = useState<CareerSave[]>([])
  const [selectedSave, setSelectedSave] = useState('')
  const [playersBySave, setPlayersBySave] = useState<Record<string, Player[]>>({})
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(blankFilters)
  const [presetId, setPresetId] = useState<PresetId>('CM')
  const [roleId, setRoleId] = useState('GENERAL')
  const [comparisonMode, setComparisonMode] = useState<'ALL' | PresetId>('ALL')
  const [comparisonView, setComparisonView] = useState<'matrix' | 'profiles' | 'ranking'>('matrix')
  const [valueIntent, setValueIntent] = useState<ValueIntent>('neutral')
  const [presets, setPresets] = useState(() => clonePresetMap(initialPresets))
  const [savedPresets, setSavedPresets] = useState(() => clonePresetMap(initialPresets))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importMessage, setImportMessage] = useState('')
  const automaticLoadRef = useRef('')

  useEffect(() => {
    listCareerSaves().then((found) => {
      let remembered: CareerSave | null = null
      try { remembered = JSON.parse(localStorage.getItem(lastSaveKey) ?? 'null') as CareerSave | null } catch { /* Ignore invalid saved selection. */ }
      const options = remembered?.path && !found.some((save) => save.path === remembered?.path) ? [remembered, ...found] : found
      setSaves(options)
      if (options.length) setSelectedSave(remembered?.path && options.some((save) => save.path === remembered?.path) ? remembered.path : options[0].path)
    }).catch(() => setSaves([]))
  }, [])

  useEffect(() => {
    setSelectedPlayerId(null)
    setCompareIds([])
  }, [selectedSave])

  useEffect(() => {
    const save = saves.find((candidate) => candidate.path === selectedSave)
    if (save) localStorage.setItem(lastSaveKey, JSON.stringify(save))
  }, [selectedSave, saves])

  const players = playersBySave[selectedSave] ?? []
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? null
  const presetKey = roleId === 'GENERAL' ? presetId : roleId
  const preset = presets[presetKey]
  const saveOptions = saves
  const positions = useMemo(() => [...new Set(players.flatMap((player) => player.positions))].sort(), [players])
  const comparedPlayers = useMemo(() => compareIds.map((id) => players.find((player) => player.id === id)).filter(Boolean) as Player[], [compareIds, players])

  const filteredPlayers = useMemo(() => players.filter((player) => {
    const matchesScope = filters.scope === 'All'
      || (filters.scope === 'Shortlist' ? player.shortlisted
        : filters.scope === 'Scouting' ? player.scouting
          : player.scope === filters.scope)
    return playerMatchesSearch(player, query) && playerMatchesPositions(player, filters.positions)
      && matchesScope
      && (filters.knowledge === 'All' || player.knowledge === filters.knowledge)
  }), [players, query, filters])

  function saveLabel(save: CareerSave) {
    return save.displayName
  }

  function applyCsv(csv: string, saveKey = selectedSave, displayName?: string) {
    const result = parsePlayerCsv(csv)
    const saveName = displayName ?? saves.find((save) => save.path === saveKey)?.displayName
    const importedPlayers = result.players.map((player) => player.club.startsWith('*TeamName_') && saveName
      ? { ...player, club: saveName }
      : player)
    setPlayersBySave((current) => ({ ...current, [saveKey]: importedPlayers }))
    setImportMessage(`${result.players.length} players loaded${result.rejectedRows ? ` · ${result.rejectedRows} skipped` : ''}`)
    setSelectedPlayerId(result.players[0]?.id ?? null)
  }

  async function refreshCareer() {
    setImportMessage('Loading…')
    const selected = saves.find((candidate) => candidate.path === selectedSave)
    if (!selected) { setImportMessage('Select a career save first.'); return }
    let lastError: unknown = null
    // FIFA replaces a career file rather than updating it in place. Give the
    // replacement time to appear, rediscover it, and never keep retrying the
    // stale path captured before the save operation.
    for (const delay of [0, 150, 400, 800, 1_500]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
      try {
        const discovered = await listCareerSaves()
        const replacement = discovered.find((candidate) => candidate.path === selected.path)
          ?? discovered.find((candidate) => candidate.displayName === selected.displayName && candidate.isAutosave === selected.isAutosave)
          ?? discovered.find((candidate) => candidate.displayName === selected.displayName)
          ?? selected
        setSaves((current) => [...discovered, ...current.filter((candidate) => !discovered.some((fresh) => fresh.path === candidate.path) && candidate.path === replacement.path)])
        const csv = await readCareerSave(replacement.path)
        applyCsv(csv, replacement.path, replacement.displayName)
        if (replacement.path !== selectedSave) setSelectedSave(replacement.path)
        return
      } catch (error) {
        lastError = error
        if (!String(error).toLowerCase().includes('file specified') && !String(error).toLowerCase().includes('not found')) break
      }
    }
    setImportMessage(lastError instanceof Error ? lastError.message : String(lastError))
  }

  useEffect(() => {
    if (!selectedSave || playersBySave[selectedSave] || automaticLoadRef.current === selectedSave) return
    automaticLoadRef.current = selectedSave
    void refreshCareer()
  }, [selectedSave])

  async function selectCareerFile() {
    try {
      const picked = await pickCareerSave()
      if (!picked) return
      setSaves((current) => [picked.save, ...current.filter((save) => save.path !== picked.save.path)])
      applyCsv(picked.csv, picked.save.path, picked.save.displayName)
      setSelectedSave(picked.save.path)
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function toggleCompare(id: string) {
    setCompareIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function toggleAllCompared(group: Player[]) {
    const ids = group.map((player) => player.id)
    const allSelected = ids.length > 0 && ids.every((id) => compareIds.includes(id))
    setCompareIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])])
  }

  function updateWeight(key: AttributeKey, value: number) {
    setPresets((current) => ({
      ...current,
      [presetKey]: { ...current[presetKey], weights: { ...current[presetKey].weights, [key]: Math.max(0, Math.min(10, value || 0)) } },
    }))
  }

  function savePresetDefaults() {
    const snapshot = clonePresetMap(presets)
    setSavedPresets(snapshot)
    localStorage.setItem(savedPresetsKey, JSON.stringify(snapshot))
  }

  function createCustomPreset(position: PresetId, name: string, description: string) {
    const id = `CUSTOM_${position}_${Date.now().toString(36)}`
    const custom: PositionPreset = { id, name, position, description, weights: { ...defaultPresets[position].weights } }
    setPresets((current) => {
      const next = { ...current, [id]: custom }
      const snapshot = clonePresetMap(next)
      setSavedPresets(snapshot)
      localStorage.setItem(savedPresetsKey, JSON.stringify(snapshot))
      return next
    })
    setPresetId(position)
    setRoleId(id)
  }

  function deleteCustomPreset(id: string) {
    const target = presets[id]
    if (!target || !isCustomPreset(target)) return
    setPresets((current) => {
      const next = { ...current }
      delete next[id]
      const snapshot = clonePresetMap(next)
      setSavedPresets(snapshot)
      localStorage.setItem(savedPresetsKey, JSON.stringify(snapshot))
      return next
    })
    setRoleId('GENERAL')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">CL</div><div><strong>Career Lens</strong><span>FIFA 22</span></div></div>
      <nav aria-label="Main navigation">
        <NavButton active={view === 'database'} icon={<Database size={18}/>} label="Players" onClick={() => setView('database')}/>
        <NavButton active={view === 'compare'} icon={<Users size={18}/>} label="Compare" count={compareIds.length} onClick={() => setView('compare')}/>
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-button" onClick={() => setSettingsOpen(true)}><Settings size={18}/>Presets</button>
      </div>
    </aside>

    <main>
      <header className="topbar">
        <div className="save-picker">
          <label htmlFor="save">Career</label>
          <div className="select-wrap"><select id="save" value={selectedSave} onChange={(event) => setSelectedSave(event.target.value)}>
            {!saveOptions.length && <option value="">No career saves found</option>}
            {saveOptions.map((save) => <option key={save.path} value={save.path}>{saveLabel(save)}</option>)}
          </select><ChevronDown size={15}/></div>
        </div>
        <div className="top-actions">
          {importMessage && <span className="import-message"><Check size={15}/>{importMessage}</span>}
          <button className="secondary" onClick={() => void selectCareerFile()}><FolderOpen size={17}/>Select save</button>
          <button className="primary" onClick={() => void refreshCareer()}><RefreshCw size={17}/>Refresh data</button>
        </div>
      </header>

      <section className="content">
        {view === 'database' && <DatabaseView players={filteredPlayers} allCount={players.length} selected={selectedPlayer} compareIds={compareIds} query={query} filters={filters} positions={positions} onQuery={setQuery} onFilters={setFilters} onSelect={setSelectedPlayerId} onCompare={toggleCompare} onCompareAll={() => toggleAllCompared(filteredPlayers)}/>} 
        {view === 'compare' && <CompareView players={comparedPlayers} allPlayers={players} compareIds={compareIds} presets={presets} preset={preset} mode={comparisonMode} comparisonView={comparisonView} roleId={roleId} valueIntent={valueIntent} onMode={(mode) => { setComparisonMode(mode); if (mode !== 'ALL') { setPresetId(mode); setRoleId('GENERAL') } }} onComparisonView={setComparisonView} onRole={setRoleId} onValueIntent={setValueIntent} onToggle={toggleCompare} onRemoveAll={() => setCompareIds([])} onKeep={(ids) => setCompareIds(ids)}/>}
      </section>
    </main>

    {settingsOpen && <SettingsPanel presets={presets} presetId={presetId} roleId={roleId} onPreset={(id) => { setPresetId(id); setRoleId('GENERAL') }} onRole={setRoleId} onWeight={updateWeight} onCreate={createCustomPreset} onDelete={deleteCustomPreset} onFactoryReset={() => { setPresets(clonePresetMap()); setRoleId('GENERAL') }} onSavedReset={() => setPresets(clonePresetMap(savedPresets))} onSave={savePresetDefaults} onClose={() => setSettingsOpen(false)}/>}
  </div>
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}{label}{count ? <span className="nav-count">{count}</span> : null}</button>
}

function EmptyState() {
  return <div className="empty-state"><Database size={30}/><h2>No player data</h2><p>Select a FIFA 22 career save to begin.</p></div>
}

function DatabaseView({ players, allCount, selected, compareIds, query, filters, positions, onQuery, onFilters, onSelect, onCompare, onCompareAll }: {
  players: Player[]; allCount: number; selected: Player | null; compareIds: string[]; query: string; filters: Filters; positions: string[]
  onQuery: (value: string) => void; onFilters: (value: Filters) => void; onSelect: (id: string) => void; onCompare: (id: string) => void; onCompareAll: () => void
}) {
  const pageSize = 100
  const [page, setPage] = useState(0)
  const [keyboardIndex, setKeyboardIndex] = useState(-1)
  const pageCount = Math.max(1, Math.ceil(players.length / pageSize))
  useEffect(() => setPage(0), [players])
  const visiblePlayers = players.slice(page * pageSize, (page + 1) * pageSize)
  useEffect(() => setKeyboardIndex(-1), [query, page, visiblePlayers.length])
  useEffect(() => {
    if (keyboardIndex < 0) return
    document.getElementById(`database-player-${visiblePlayers[keyboardIndex]?.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [keyboardIndex, visiblePlayers])

  function searchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!query.trim() || !visiblePlayers.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setKeyboardIndex((current) => current < 0 ? 0 : (current + direction + visiblePlayers.length) % visiblePlayers.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const player = visiblePlayers[keyboardIndex < 0 ? 0 : keyboardIndex]
      if (player) {
        onSelect(player.id)
        if (!compareIds.includes(player.id)) onCompare(player.id)
      }
    }
  }
  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">Database</span><h1>Players</h1></div><span className="result-count">{players.length.toLocaleString()} / {allCount.toLocaleString()}</span></div>
    {allCount === 0 ? <EmptyState/> : <>
      <div className="toolbar">
        <div className="search"><Search size={17}/><input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={searchKeyDown} aria-activedescendant={keyboardIndex >= 0 ? `database-player-${visiblePlayers[keyboardIndex]?.id}` : undefined} placeholder="Search players, clubs or positions"/></div>
        <button className="secondary" disabled={!players.length} onClick={onCompareAll}><Check size={17}/>{players.length > 0 && players.every((player) => compareIds.includes(player.id)) ? 'Remove all' : 'Select all'}</button>
        {(query || filters.positions.length > 0 || filters.scope !== 'All' || filters.knowledge !== 'All') && <button className="text-button" onClick={() => { onQuery(''); onFilters(blankFilters) }}>Clear</button>}
      </div>
      <div className="filters">
        <PositionMultiSelect values={filters.positions} options={positions} onChange={(positions) => onFilters({ ...filters, positions })}/>
        <FilterSelect label="Source" value={filters.scope} options={['My squad', 'Youth academy', 'Scouting', 'Shortlist', 'Player search', 'Other']} onChange={(scope) => onFilters({ ...filters, scope })}/>
        <FilterSelect label="Knowledge" value={filters.knowledge} options={['Exact', 'Ranged', 'Unknown']} onChange={(knowledge) => onFilters({ ...filters, knowledge })}/>
      </div>
      <div className={`database-layout ${selected ? 'detail-open' : ''}`}>
        <div className="table-card"><PlayerTable players={visiblePlayers} selectedId={selected?.id ?? null} keyboardActiveId={keyboardIndex >= 0 ? visiblePlayers[keyboardIndex]?.id ?? null : null} compareIds={compareIds} onSelect={onSelect} onCompare={onCompare}/>
          {players.length > pageSize && <div className="pagination"><span>{page + 1} / {pageCount}</span><div><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft size={16}/></button><button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}><ChevronRight size={16}/></button></div></div>}
        </div>
        {selected && <PlayerDetail player={selected} compared={compareIds.includes(selected.id)} onClose={() => onSelect('')} onCompare={() => onCompare(selected.id)}/>} 
      </div>
    </>}
  </div>
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<span className="filter-select"><select value={value} onChange={(event) => onChange(event.target.value)}><option>All</option>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={15}/></span></label>
}

function PositionMultiSelect({ values, options, onChange }: { values: string[]; options: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const summary = values.length === 0 ? 'All' : values.length <= 2 ? values.join(', ') : `${values.length} selected`
  const toggle = (option: string) => onChange(values.includes(option) ? values.filter((value) => value !== option) : [...values, option])
  return <div className="filter-multi" ref={rootRef}><span className="filter-label">Position</span><button type="button" className={`multi-select-trigger ${open ? 'open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>{summary}</span><ChevronDown size={15}/></button>{open && <div className="multi-select-menu" role="listbox" aria-label="Positions" aria-multiselectable="true"><button type="button" className={values.length === 0 ? 'selected' : ''} onClick={() => onChange([])}><span className="multi-check">{values.length === 0 && <Check size={12}/>}</span>All</button>{options.map((option) => { const selected = values.includes(option); return <button type="button" key={option} className={selected ? 'selected' : ''} role="option" aria-selected={selected} onClick={() => toggle(option)}><span className="multi-check">{selected && <Check size={12}/>}</span>{option}</button> })}</div>}</div>
}

function PlayerTable({ players, selectedId, keyboardActiveId, compareIds, onSelect, onCompare }: { players: Player[]; selectedId: string | null; keyboardActiveId: string | null; compareIds: string[]; onSelect: (id: string) => void; onCompare: (id: string) => void }) {
  if (!players.length) return <div className="no-results">No matching players</div>
  return <div className="table-scroll"><table><thead><tr><th>Player</th><th>Position</th><th>Age</th><th>OVR</th><th>Potential</th><th>Source</th><th>Knowledge</th><th>Value</th><th/></tr></thead>
    <tbody>{players.map((player) => <tr id={`database-player-${player.id}`} key={player.id} className={`${selectedId === player.id ? 'selected-row' : ''} ${keyboardActiveId === player.id ? 'keyboard-active' : ''}`} onClick={() => onSelect(player.id)} onDoubleClick={() => onCompare(player.id)}>
      <td><strong>{player.name}</strong><span>{player.club}</span></td><td>{player.positions.join(' · ')}</td><td>{player.age ?? '—'}</td><td><Rating value={player.overall}/></td><td><Rating value={player.potential}/></td><td>{player.scope}</td><td><Knowledge level={player.knowledge}/></td><td>{formatMoney(player.value, player.currency)}</td>
      <td><button className={`compare-check ${compareIds.includes(player.id) ? 'checked' : ''}`} title="Toggle comparison" onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCompare(player.id) }}>{compareIds.includes(player.id) ? <Check size={15}/> : '+'}</button></td>
    </tr>)}</tbody></table></div>
}

function Knowledge({ level }: { level: Player['knowledge'] }) { return <span className={`knowledge ${level.toLowerCase()}`}>{level}</span> }
function Rating({ value }: { value: RatingRange | null }) { return <span className={!value ? 'unknown' : value.min !== value.max ? 'range' : ''}>{formatRating(value)}</span> }

function fifaRatingClass(value: RatingRange | null) {
  const point = midpoint(value)
  if (point === null) return 'fifa-unknown'
  return `fifa-${fifaRatingBand(point)}`
}

function FifaStatRating({ value }: { value: RatingRange | null }) {
  if (!value) return <strong className="fifa-unknown">—</strong>
  if (value.min === value.max) return <strong className={fifaRatingClass(value)}>{value.min}</strong>
  return <span className="fifa-rating-range"><strong className={`fifa-${fifaRatingBand(value.min)}`}>{value.min}</strong><i>–</i><strong className={`fifa-${fifaRatingBand(value.max)}`}>{value.max}</strong></span>
}

function PlayerDetail({ player, compared, onClose, onCompare }: { player: Player; compared: boolean; onClose: () => void; onCompare: () => void }) {
  return <aside className="detail-panel">
    <div className="detail-head"><div><p>{player.positions.join(' · ') || '—'}</p><h2>{player.name}</h2><span>{player.club} · {player.age ?? '—'} · {player.preferredFoot}</span></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>
    <PlayerFacts player={player} action={<button className={`wide-button ${compared ? 'selected' : ''}`} onClick={onCompare}>{compared ? <><Check size={16}/>In comparison</> : <>+ Compare</>}</button>}/>
  </aside>
}

function PlayerFacts({ player, action, score = null, scoreClass = '' }: { player: Player; action?: React.ReactNode; score?: RatingRange | null; scoreClass?: string }) {
  const hasScore = score !== null
  return <>
    <div className={`summary-grid ${player.scope === 'Youth academy' ? 'with-potential' : ''} ${hasScore ? 'with-score' : ''}`}>{hasScore && <div className={scoreClass}><span>Score</span><strong>{formatRating(score)}</strong></div>}<div><span>Overall</span><strong>{formatRating(player.overall)}</strong></div>{player.scope === 'Youth academy' && <div><span>Potential</span><strong>{formatRating(player.potential)}</strong></div>}<div><span>Value</span><strong>{formatMoney(player.value, player.currency)}</strong></div><div><span>Wage</span><strong>{formatMoney(player.wage, player.currency)}</strong></div></div>
    <div className="detail-meta"><Knowledge level={player.knowledge}/><span>{player.scope}</span></div>
    {action}
    <section className="fifa-summary"><h3>Summary</h3>{summaryCategories.map((category) => { const value = averageRating(player, category.keys, category.rounding, category.weights); return <div key={category.name}><span>{category.name}</span><FifaStatRating value={value}/></div> })}</section>
    <AttributeSections player={player}/>
  </>
}

function AttributeSections({ player }: { player: Player }) {
  return <div className="attribute-sections fifa-attribute-sections">{fifaDetailGroups.map((group) => <section key={group.name}><h3>{group.name}:</h3><div className="attribute-grid">{group.stats.map(({ key, label }) => <div key={key}><span>{label}</span><FifaStatRating value={player.attributes[key]}/></div>)}</div></section>)}</div>
}

function CompareView({ players, allPlayers, compareIds, presets, preset, mode, comparisonView, roleId, valueIntent, onMode, onComparisonView, onRole, onValueIntent, onToggle, onRemoveAll, onKeep }: {
  players: Player[]; allPlayers: Player[]; compareIds: string[]; presets: PresetMap; preset: PositionPreset; mode: 'ALL' | PresetId; comparisonView: 'matrix' | 'profiles' | 'ranking'; roleId: string; valueIntent: ValueIntent
  onMode: (id: 'ALL' | PresetId) => void; onComparisonView: (view: 'matrix' | 'profiles' | 'ranking') => void; onRole: (id: string) => void; onValueIntent: (intent: ValueIntent) => void; onToggle: (id: string) => void; onRemoveAll: () => void; onKeep: (ids: string[]) => void
}) {
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerActiveIndex, setPickerActiveIndex] = useState(-1)
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [focusDraft, setFocusDraft] = useState<string[] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [profileScrollLocked, setProfileScrollLocked] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false)
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [])
  useEffect(() => { if (mode === 'ALL' && comparisonView === 'ranking') onComparisonView('matrix') }, [mode, comparisonView, onComparisonView])
  useEffect(() => {
    setFocusIds((current) => current.filter((id) => compareIds.includes(id)))
    setFocusDraft((current) => current?.filter((id) => compareIds.includes(id)) ?? null)
  }, [compareIds])
  useEffect(() => {
    if (!exportMessage) return
    const timer = window.setTimeout(() => setExportMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [exportMessage])
  const relevantKeys = (Object.entries(preset.weights) as [AttributeKey, number][]).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const pickerNeedle = pickerQuery.trim().toLowerCase()
  const pickerPlayers = pickerNeedle.length < 2 ? [] : allPlayers.filter((player) => playerMatchesSearch(player, pickerQuery)).slice(0, 60)
  useEffect(() => setPickerActiveIndex(-1), [pickerQuery, pickerPlayers.length])
  useEffect(() => {
    if (pickerActiveIndex < 0) return
    document.getElementById(`compare-option-${pickerPlayers[pickerActiveIndex]?.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [pickerActiveIndex, pickerPlayers])
  const focusActive = focusIds.length > 0
  const visiblePlayers = focusActive ? players.filter((player) => focusIds.includes(player.id)) : players
  const matrixPlayers = visiblePlayers
  const exportPlayers = visiblePlayers
  const markdown = () => buildComparisonMarkdown({ players: exportPlayers, preset, mode, view: comparisonView })
  const exportName = `career-lens-${mode === 'ALL' ? 'all-attributes' : preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.md`

  function toggleFocusDraft(id: string) {
    setFocusDraft((current) => current?.includes(id) ? current.filter((item) => item !== id) : [...(current ?? []), id])
  }

  function choosePickerPlayer(player: Player) {
    const alreadySelected = compareIds.includes(player.id)
    onToggle(player.id)
    if (!alreadySelected) setExportMessage(`${player.name} added to comparison`)
    setPickerQuery('')
    setPickerOpen(false)
    setPickerActiveIndex(-1)
  }

  function pickerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setPickerOpen(false)
      return
    }
    if (!pickerOpen || !pickerPlayers.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setPickerActiveIndex((current) => current < 0 ? 0 : (current + direction + pickerPlayers.length) % pickerPlayers.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choosePickerPlayer(pickerPlayers[pickerActiveIndex < 0 ? 0 : pickerActiveIndex])
    }
  }

  function focusAction() {
    if (focusActive) {
      setFocusIds([])
      setFocusDraft(null)
    } else if (focusDraft === null) {
      setFocusDraft([])
    } else if (focusDraft.length) {
      setFocusIds(focusDraft)
      setFocusDraft(null)
    } else {
      setFocusDraft(null)
    }
  }

  async function copyExport() {
    try {
      await copyText(markdown())
      setExportMessage('Markdown copied')
      setExportOpen(false)
    } catch { setExportMessage('Could not copy Markdown') }
  }

  async function fileExport() {
    try {
      const saved = await saveMarkdownExport(markdown(), exportName)
      setExportMessage(saved ? 'Markdown exported' : '')
      setExportOpen(false)
    } catch (error) { setExportMessage(error instanceof Error ? error.message : String(error)) }
  }

  return <div className="view-stack compare-view">
    <div className="page-heading"><div><span className="eyebrow">Comparison</span><h1>Compare players</h1>{mode !== 'ALL' && preset.description && <p className="preset-description">{preset.description}</p>}</div><div className="preset-pickers"><div className="comparison-view-switch"><button className={comparisonView === 'matrix' ? 'selected' : ''} onClick={() => onComparisonView('matrix')}><TableProperties size={14}/>Matrix</button><button className={comparisonView === 'profiles' ? 'selected' : ''} onClick={() => onComparisonView('profiles')}><Users size={14}/>Profiles</button><button className={comparisonView === 'ranking' ? 'selected' : ''} disabled={mode === 'ALL'} title={mode === 'ALL' ? 'Choose a position to calculate scores' : 'Rank by calculated score'} onClick={() => onComparisonView('ranking')}><ListOrdered size={14}/>Ranking</button></div><ComparisonModeSelect value={mode} onChange={onMode}/>{mode !== 'ALL' && <RoleSelect position={mode} value={roleId} presets={presets} onChange={onRole}/>}<ValueIntentSelect value={valueIntent} onChange={onValueIntent}/></div></div>
    {allPlayers.length === 0 ? <EmptyState/> : <>
      <div className="compare-picker" ref={pickerRef}><div className="search"><Search size={16}/><input value={pickerQuery} onFocus={() => setPickerOpen(true)} onChange={(event) => { setPickerQuery(event.target.value); setPickerOpen(true) }} onKeyDown={pickerKeyDown} aria-activedescendant={pickerActiveIndex >= 0 ? `compare-option-${pickerPlayers[pickerActiveIndex]?.id}` : undefined} placeholder="Add players"/></div><span className="selection-count">{focusActive ? `Showing ${visiblePlayers.length} of ${players.length}` : focusDraft !== null ? `${focusDraft.length} chosen for focus` : `${players.length} selected`}</span>
        <div className="compare-actions">
          {comparisonView === 'profiles' && <button className={`secondary ${profileScrollLocked ? 'selected' : ''}`} disabled={!players.length} onClick={() => setProfileScrollLocked((locked) => !locked)}>{profileScrollLocked ? <Unlock size={15}/> : <Lock size={15}/>} {profileScrollLocked ? 'Unlock scroll' : 'Lock scroll'}</button>}
          <button className={`secondary ${focusActive || focusDraft !== null ? 'selected' : ''}`} disabled={!players.length} onClick={focusAction}>{focusActive ? <EyeOff size={15}/> : <Eye size={15}/>} {focusActive ? 'Show all' : focusDraft === null ? 'Focus players' : focusDraft.length ? `Show selected (${focusDraft.length})` : 'Cancel focus'}</button>
          <div className="export-control" ref={exportRef}><button className="secondary" disabled={!visiblePlayers.length} onClick={() => setExportOpen((open) => !open)}><Download size={15}/>Export<ChevronDown size={13}/></button>{exportOpen && <div className="export-menu"><button onClick={() => void copyExport()}><Copy size={15}/><span>Copy as text</span><em>Markdown</em></button><button onClick={() => void fileExport()}><Download size={15}/><span>Save file</span><em>.md</em></button></div>}</div>
          <button className="secondary danger-button" disabled={!players.length} onClick={onRemoveAll}><Trash2 size={15}/>Remove all</button>
        </div>
        {pickerOpen && pickerNeedle.length >= 2 && <div className="compare-options">{pickerPlayers.length ? pickerPlayers.map((player, index) => { const alreadySelected = compareIds.includes(player.id); return <button id={`compare-option-${player.id}`} key={player.id} className={`${alreadySelected ? 'selected' : ''} ${pickerActiveIndex === index ? 'keyboard-active' : ''}`} onMouseEnter={() => setPickerActiveIndex(index)} onClick={() => choosePickerPlayer(player)}>{alreadySelected && <Check size={13}/>}<span>{player.name}</span><em>{player.club}</em></button> }) : <small>No matching players</small>}</div>}
      </div>
      {focusDraft !== null && <div className="focus-instruction">Select any players directly from the {comparisonView === 'matrix' ? 'player headers' : comparisonView === 'profiles' ? 'profiles' : 'ranking rows'}, then click <strong>Show selected</strong>.</div>}
      {exportMessage && <div className="comparison-notice">{exportMessage}</div>}
      {!players.length ? <div className="empty-state compact"><Users size={28}/><h2>Select players</h2></div> : comparisonView === 'profiles' ? <ComparisonProfiles players={visiblePlayers} preset={mode === 'ALL' ? null : preset} scrollLocked={profileScrollLocked} onToggle={onToggle} focusDraft={focusDraft} onFocusToggle={toggleFocusDraft}/> : comparisonView === 'ranking' && mode !== 'ALL' ? <RankingView players={visiblePlayers} preset={preset} valueIntent={valueIntent} onToggle={onToggle} onKeep={focusActive || focusDraft !== null ? undefined : onKeep} focusDraft={focusDraft} onFocusToggle={toggleFocusDraft}/> : <ComparisonMatrix players={matrixPlayers} preset={preset} mode={mode === 'ALL' ? 'general' : 'position'} relevantKeys={relevantKeys} valueIntent={valueIntent} onToggle={onToggle} focusDraft={focusDraft} onFocusToggle={toggleFocusDraft}/>}
    </>}
  </div>
}

function comparisonClass(value: RatingRange | null, values: (RatingRange | null)[]) {
  const points = values.map(midpoint).filter((point): point is number => point !== null)
  const point = midpoint(value)
  if (point === null || points.length < 2 || Math.max(...points) === Math.min(...points)) return ''
  if (point === Math.max(...points)) return 'best'
  if (point === Math.min(...points)) return 'worst'
  return ''
}

function valueComparisonClass(value: RatingRange | null, values: (RatingRange | null)[], intent: ValueIntent) {
  if (intent === 'neutral') return ''
  const relative = comparisonClass(value, values)
  if (intent === 'selling') return relative
  return relative === 'best' ? 'worst' : relative === 'worst' ? 'best' : ''
}

function ComparisonProfiles({ players, preset, scrollLocked, onToggle, focusDraft, onFocusToggle }: { players: Player[]; preset: PositionPreset | null; scrollLocked: boolean; onToggle: (id: string) => void; focusDraft: string[] | null; onFocusToggle: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const scores = players.map((player) => preset ? scoreForPreset(player, preset).score : null)
  useEffect(() => {
    if (!scrollLocked) return
    containerRef.current?.querySelectorAll<HTMLElement>('.profile-scroll').forEach((element) => { element.scrollTop = 0 })
  }, [scrollLocked])

  function syncProfileScroll(event: React.UIEvent<HTMLDivElement>) {
    if (!scrollLocked || syncingRef.current) return
    syncingRef.current = true
    const source = event.currentTarget
    containerRef.current?.querySelectorAll<HTMLElement>('.profile-scroll').forEach((element) => {
      if (element !== source) element.scrollTop = source.scrollTop
    })
    window.setTimeout(() => { syncingRef.current = false }, 0)
  }

  return <div className="comparison-profiles" ref={containerRef}>{players.map((player, index) => {
    const focusClass = focusDraft === null ? '' : focusDraft.includes(player.id) ? 'focus-picking focus-selected' : 'focus-picking focus-unselected'
    return <article className={`comparison-profile ${focusClass}`} key={player.id} onClick={() => focusDraft !== null && onFocusToggle(player.id)}>
      <div className="detail-head"><div><p>{player.positions.join(' · ') || '—'}</p><h2>{player.name}</h2><span>{player.club} · {player.age ?? '—'} · {player.preferredFoot}</span></div>{focusDraft === null && <button className="icon-button" title="Remove from comparison" aria-label={`Remove ${player.name} from comparison`} onClick={() => onToggle(player.id)}><X size={19}/></button>}</div>
      <div className="profile-scroll" onScroll={syncProfileScroll}><PlayerFacts player={player} score={scores[index]} scoreClass={comparisonClass(scores[index], scores) === 'best' ? 'score-best' : ''}/></div>
    </article>
  })}</div>
}

function RankingView({ players, preset, valueIntent, onToggle, onKeep, focusDraft, onFocusToggle }: { players: Player[]; preset: PositionPreset; valueIntent: ValueIntent; onToggle: (id: string) => void; onKeep?: (ids: string[]) => void; focusDraft: string[] | null; onFocusToggle: (id: string) => void }) {
  const ranked = [...players].sort((left, right) => (midpoint(scoreForPreset(right, preset).score) ?? -1) - (midpoint(scoreForPreset(left, preset).score) ?? -1))
  const ages = players.map((player) => player.age).filter((age): age is number => age !== null)
  const youngest = ages.length > 1 ? Math.min(...ages) : null
  const oldest = ages.length > 1 ? Math.max(...ages) : null
  const values = players.map((player) => player.value)
  const overallValues = players.map((player) => player.overall)
  return <div className="ranking-card"><div className="ranking-head"><span>Rank</span><span>Player</span><span>Score</span><span>OVR</span><span>Age</span><span>Value</span><span>Wage</span><span/></div>{ranked.map((player, index) => {
    const ageClass = youngest !== null && youngest !== oldest && player.age === youngest ? 'best' : oldest !== null && youngest !== oldest && player.age === oldest ? 'worst' : ''
    const focusClass = focusDraft === null ? '' : focusDraft.includes(player.id) ? 'focus-picking focus-selected' : 'focus-picking focus-unselected'
    return <div className={`ranking-row ${focusClass}`} key={player.id} onClick={() => focusDraft !== null && onFocusToggle(player.id)}><strong className="rank-number">{index + 1}</strong><div className="ranking-player"><div className="player-avatar">{player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</div><div><strong>{player.name}</strong><span>{player.positions.join(' · ')} · {player.club}</span></div></div><strong className="ranking-score">{formatRating(scoreForPreset(player, preset).score)}</strong><strong className={`ranking-overall ${comparisonClass(player.overall, overallValues)}`}>{formatRating(player.overall)}</strong><strong className={`ranking-age ${ageClass}`}>{player.age ?? '—'}</strong><strong className={`ranking-value ${valueComparisonClass(player.value, values, valueIntent)}`}>{formatMoney(player.value, player.currency)}</strong><strong className="ranking-wage">{formatMoney(player.wage, player.currency)}</strong><div className="ranking-actions">{focusDraft === null && <>{onKeep && index < ranked.length - 1 && <button className="tooltip-button" data-tooltip="Remove all below" aria-label={`Remove everyone below ${player.name}`} onClick={(event) => { event.stopPropagation(); onKeep(ranked.slice(0, index + 1).map((item) => item.id)) }}><ListX size={14}/></button>}<button aria-label={`Remove ${player.name} from comparison`} title="Remove from comparison" onClick={(event) => { event.stopPropagation(); onToggle(player.id) }}><X size={15}/></button></>}</div></div>
  })}</div>
}

function ComparisonMatrix({ players, preset, mode, relevantKeys, valueIntent, onToggle, focusDraft, onFocusToggle }: { players: Player[]; preset: PositionPreset; mode: 'general' | 'position'; relevantKeys: AttributeKey[]; valueIntent: ValueIntent; onToggle: (id: string) => void; focusDraft: string[] | null; onFocusToggle: (id: string) => void }) {
  const [focusedRow, setFocusedRow] = useState<string | null>(null)
  const overallValues = players.map((player) => player.overall)
  const scoreValues = players.map((player) => scoreForPreset(player, preset).score)
  const gridStyle = { '--players': players.length } as React.CSSProperties
  const focus = (row: string) => setFocusedRow((current) => current === row ? null : row)
  const rowClass = (row: string) => focusedRow === row ? 'row-focused' : ''
  return <div className="comparison-card"><div className="comparison-frame" style={gridStyle}>
    <div className="comparison-grid comparison-header" style={gridStyle}><div className="comparison-label corner-cell">Attribute</div>{players.map((player) => { const focusClass = focusDraft === null ? '' : focusDraft.includes(player.id) ? 'focus-picking focus-selected' : 'focus-picking focus-unselected'; return <div className={`comparison-player ${focusClass}`} key={player.id} onClick={() => focusDraft !== null && onFocusToggle(player.id)}>{focusDraft === null && <div className="comparison-player-actions"><button aria-label={`Remove ${player.name} from comparison`} title="Remove from comparison" onClick={(event) => { event.stopPropagation(); onToggle(player.id) }}><X size={14}/></button></div>}<div className="player-avatar">{player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</div><strong>{player.name}</strong><span>{player.positions.join(' · ')}</span><em>{player.club}</em></div> })}</div>
    <div className="comparison-body"><div className="comparison-grid comparison-body-grid" style={gridStyle}>
      {mode === 'position' && <><div className={`comparison-label score-label ${rowClass('score')}`} onClick={() => focus('score')}>Score</div>{players.map((player) => { const result = scoreForPreset(player, preset); return <div className={`score-cell ${comparisonClass(result.score, scoreValues)} ${rowClass('score')}`} onClick={() => focus('score')} key={player.id}><strong>{formatRating(result.score)}</strong><span>{result.coverage}% known</span></div> })}</>}
      <ComparisonRow rowId="overall" label="Overall" players={players} values={overallValues} focused={focusedRow === 'overall'} onFocus={focus}/>
      <AgeComparisonRow players={players} focused={focusedRow === 'age'} onFocus={focus}/>
      <ValueComparisonRow players={players} intent={valueIntent} focused={focusedRow === 'value'} onFocus={focus}/>
      {(mode === 'general' ? attributeKeys : relevantKeys).map((key) => <ComparisonRow rowId={key} key={key} label={attributeLabels[key]} players={players} values={players.map((player) => player.attributes[key])} weight={mode === 'position' ? preset.weights[key] : undefined} focused={focusedRow === key} onFocus={focus}/>) }
    </div></div>
  </div></div>
}

function AgeComparisonRow({ players, focused, onFocus }: { players: Player[]; focused: boolean; onFocus: (row: string) => void }) {
  const ages = players.map((player) => player.age).filter((age): age is number => age !== null)
  const youngest = ages.length > 1 ? Math.min(...ages) : null
  const oldest = ages.length > 1 ? Math.max(...ages) : null
  const focusedClass = focused ? 'row-focused' : ''
  return <><div className={`comparison-label ${focusedClass}`} onClick={() => onFocus('age')}>Age</div>{players.map((player) => {
    const className = youngest !== null && youngest !== oldest && player.age === youngest ? 'best'
      : oldest !== null && youngest !== oldest && player.age === oldest ? 'worst' : ''
    return <div className={`comparison-value ${className} ${focusedClass}`} onClick={() => onFocus('age')} key={player.id}>{player.age ?? '—'}</div>
  })}</>
}

function ValueComparisonRow({ players, intent, focused, onFocus }: { players: Player[]; intent: ValueIntent; focused: boolean; onFocus: (row: string) => void }) {
  const values = players.map((player) => player.value)
  const focusedClass = focused ? 'row-focused' : ''
  return <><div className={`comparison-label ${focusedClass}`} onClick={() => onFocus('value')}>Value</div>{players.map((player, index) => {
    const className = valueComparisonClass(values[index], values, intent)
    return <div className={`comparison-value ${className} ${focusedClass}`} onClick={() => onFocus('value')} key={player.id}>{formatMoney(values[index], player.currency)}</div>
  })}</>
}

function ComparisonRow({ rowId, label, players, values, weight, focused, onFocus }: { rowId: string; label: string; players: Player[]; values: (RatingRange | null)[]; weight?: number; focused: boolean; onFocus: (row: string) => void }) {
  const focusedClass = focused ? 'row-focused' : ''
  return <><div className={`comparison-label ${focusedClass}`} onClick={() => onFocus(rowId)}>{label}{weight !== undefined && <span>{weight}</span>}</div>{players.map((player, index) => <div className={`comparison-value ${comparisonClass(values[index], values)} ${focusedClass}`} onClick={() => onFocus(rowId)} key={player.id}>{formatRating(values[index])}</div>)}</>
}

function PresetSelect({ value, onChange }: { value: PresetId; onChange: (id: PresetId) => void }) {
  return <div className="select-wrap preset-select"><select value={value} onChange={(event) => onChange(event.target.value as PresetId)}>{Object.values(defaultPresets).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><ChevronDown size={15}/></div>
}

function ComparisonModeSelect({ value, onChange }: { value: 'ALL' | PresetId; onChange: (id: 'ALL' | PresetId) => void }) {
  return <div className="select-wrap preset-select"><select aria-label="Comparison type" value={value} onChange={(event) => onChange(event.target.value as 'ALL' | PresetId)}><option value="ALL">All attributes</option>{Object.values(defaultPresets).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><ChevronDown size={15}/></div>
}

function ValueIntentSelect({ value, onChange }: { value: ValueIntent; onChange: (intent: ValueIntent) => void }) {
  return <div className="select-wrap value-intent-select"><select aria-label="Value comparison intent" value={value} onChange={(event) => onChange(event.target.value as ValueIntent)}><option value="neutral">Value: Neutral</option><option value="buying">Value: Buying</option><option value="selling">Value: Selling</option></select><ChevronDown size={15}/></div>
}

function RoleSelect({ position, value, presets, onChange }: { position: PresetId; value: string; presets: PresetMap; onChange: (id: string) => void }) {
  const custom = Object.values(presets).filter((preset) => isCustomPreset(preset) && preset.position === position)
  return <div className="select-wrap role-select"><select aria-label="Player type" value={value} onChange={(event) => onChange(event.target.value)}><option value="GENERAL">General</option>{rolePresets[position].map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}{custom.length > 0 && <option className="preset-section-label" disabled>Custom presets</option>}{custom.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><ChevronDown size={15}/></div>
}

function SettingsPanel({ presets, presetId, roleId, onPreset, onRole, onWeight, onCreate, onDelete, onFactoryReset, onSavedReset, onSave, onClose }: { presets: PresetMap; presetId: PresetId; roleId: string; onPreset: (id: PresetId) => void; onRole: (id: string) => void; onWeight: (key: AttributeKey, value: number) => void; onCreate: (position: PresetId, name: string, description: string) => void; onDelete: (id: string) => void; onFactoryReset: () => void; onSavedReset: () => void; onSave: () => void; onClose: () => void }) {
  const [creating, setCreating] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [customName, setCustomName] = useState('')
  const [customPosition, setCustomPosition] = useState<PresetId>(presetId)
  const [customDescription, setCustomDescription] = useState('')
  const preset = presets[roleId === 'GENERAL' ? presetId : roleId]
  useEffect(() => {
    if (!actionMessage) return
    const timer = window.setTimeout(() => setActionMessage(''), 3000)
    return () => window.clearTimeout(timer)
  }, [actionMessage])
  useEffect(() => setConfirmingDelete(false), [preset.id])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="settings-panel">
    <div className="settings-head"><div><span className="eyebrow">Preset settings</span><h2>{preset.name}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="settings-toolbar"><div className="preset-pickers settings-preset-pickers"><PresetSelect value={presetId} onChange={onPreset}/><RoleSelect position={presetId} value={roleId} presets={presets} onChange={onRole}/><button className="secondary" onClick={() => { setConfirmingDelete(false); setCustomPosition(presetId); setCreating((open) => !open) }}><Plus size={15}/>Create preset</button>{isCustomPreset(preset) && <button className="secondary danger-button" onClick={() => { setCreating(false); setConfirmingDelete(true) }}><Trash2 size={15}/>Delete preset</button>}</div>{confirmingDelete && isCustomPreset(preset) && <div className="preset-delete-confirmation"><span>Delete <strong>{preset.name}</strong>? This cannot be undone.</span><div><button className="text-button" onClick={() => setConfirmingDelete(false)}>Cancel</button><button className="danger-confirm" onClick={() => { const deletedName = preset.name; onDelete(preset.id); setConfirmingDelete(false); setActionMessage(`${deletedName} deleted`) }}>Delete</button></div></div>}{actionMessage && <div className="preset-action-message"><Check size={14}/>{actionMessage}</div>}{preset.description && <p className="preset-description">{preset.description}</p>}
      {creating && <form className="custom-preset-form" onSubmit={(event) => { event.preventDefault(); const name = customName.trim(); if (!name) return; onCreate(customPosition, name, customDescription.trim()); setCustomName(''); setCustomDescription(''); setCreating(false) }}><label>Name<input autoFocus value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="e.g. Dribbling striker"/></label><label>Category<select value={customPosition} onChange={(event) => setCustomPosition(event.target.value as PresetId)}>{Object.values(defaultPresets).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="description-field">Description<input value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} placeholder="What this preset looks for"/></label><button className="primary" type="submit" disabled={!customName.trim()}>Create</button></form>}
    </div>
    <div className="weight-list">{attributeGroups.map((group) => <section key={group.name}><h3>{group.name}</h3>{group.keys.map((key) => <label key={key}><span>{attributeLabels[key]}</span><input type="range" min="0" max="10" value={preset.weights[key] ?? 0} onChange={(event) => onWeight(key, Number(event.target.value))}/><input className="weight-number" type="number" min="0" max="10" value={preset.weights[key] ?? 0} onChange={(event) => onWeight(key, Number(event.target.value))}/></label>)}</section>)}</div>
    <div className="settings-actions"><div><button className="secondary" onClick={onFactoryReset}>Factory defaults</button><button className="secondary" onClick={onSavedReset}>Reset to saved</button></div><div><button className="text-button" onClick={onClose}>Close</button><button className="primary" onClick={() => { onSave(); onClose() }}>Save as default</button></div></div>
  </div></div>
}

export default App
