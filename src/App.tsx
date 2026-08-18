import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Database, FolderOpen, ListOrdered, RefreshCw, Search, Settings, TableProperties, Users, X } from 'lucide-react'
import { parsePlayerCsv } from './csv'
import { listCareerSaves, pickCareerSave, readCareerSave } from './saves'
import { attributeGroups, attributeLabels, defaultPresets, formatMoney, formatRating, midpoint, scoreForPreset } from './scoring'
import { allRolePresets, rolePresets } from './roles'
import { averageRating, summaryCategories } from './summary'
import { playerMatchesSearch } from './search'
import { attributeKeys, type AttributeKey, type CareerSave, type Player, type PositionPreset, type PresetId, type RatingRange } from './types'
import './styles.css'

type View = 'database' | 'compare'
type ValueIntent = 'neutral' | 'buying' | 'selling'
type Filters = { position: string; scope: string; knowledge: string }
type PresetMap = Record<string, PositionPreset>

const blankFilters: Filters = { position: 'All', scope: 'All', knowledge: 'All' }
function factoryPresetMap(): PresetMap {
  return Object.fromEntries([...Object.values(defaultPresets), ...allRolePresets].map((preset) => [preset.id, preset]))
}

function clonePresetMap(source: PresetMap = factoryPresetMap()): PresetMap {
  return Object.fromEntries(Object.entries(source).map(([id, preset]) => [id, { ...preset, weights: { ...preset.weights } }])) as PresetMap
}

function loadSavedPresets(): PresetMap {
  const result = clonePresetMap(factoryPresetMap())
  try {
    const saved = JSON.parse(localStorage.getItem('career-lens-presets-v4') ?? '{}') as Partial<Record<string, PositionPreset>>
    for (const id of Object.keys(result)) {
      for (const key of attributeKeys) {
        const value = Number(saved[id]?.weights?.[key])
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
  const [valueIntent, setValueIntent] = useState<ValueIntent>('neutral')
  const [presets, setPresets] = useState(() => clonePresetMap(initialPresets))
  const [savedPresets, setSavedPresets] = useState(() => clonePresetMap(initialPresets))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importMessage, setImportMessage] = useState('')

  useEffect(() => {
    listCareerSaves().then((found) => {
      setSaves(found)
      if (found.length) setSelectedSave(found[0].path)
    }).catch(() => setSaves([]))
  }, [])

  useEffect(() => {
    setSelectedPlayerId(null)
    setCompareIds([])
  }, [selectedSave])

  const players = playersBySave[selectedSave] ?? []
  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? null
  const presetKey = roleId === 'GENERAL' ? presetId : roleId
  const preset = presets[presetKey]
  const saveOptions = saves
  const positions = useMemo(() => [...new Set(players.flatMap((player) => player.positions))].sort(), [players])
  const comparedPlayers = useMemo(() => compareIds.map((id) => players.find((player) => player.id === id)).filter(Boolean) as Player[], [compareIds, players])

  const filteredPlayers = useMemo(() => players.filter((player) => {
    return playerMatchesSearch(player, query) && (filters.position === 'All' || player.positions.includes(filters.position))
      && (filters.scope === 'All' || player.scope === filters.scope)
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
    try {
      setImportMessage('Loading…')
      const save = saves.find((candidate) => candidate.path === selectedSave)
      if (!save) throw new Error('Select a career save first.')
      applyCsv(await readCareerSave(save.path))
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : String(error))
    }
  }

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
    localStorage.setItem('career-lens-presets-v4', JSON.stringify(snapshot))
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
        {view === 'compare' && <CompareView players={comparedPlayers} allPlayers={players} compareIds={compareIds} preset={preset} mode={comparisonMode} roleId={roleId} valueIntent={valueIntent} onMode={(mode) => { setComparisonMode(mode); if (mode !== 'ALL') { setPresetId(mode); setRoleId('GENERAL') } }} onRole={setRoleId} onValueIntent={setValueIntent} onToggle={toggleCompare}/>} 
      </section>
    </main>

    {settingsOpen && <SettingsPanel presets={presets} presetId={presetId} roleId={roleId} onPreset={(id) => { setPresetId(id); setRoleId('GENERAL') }} onRole={setRoleId} onWeight={updateWeight} onFactoryReset={() => setPresets(clonePresetMap())} onSavedReset={() => setPresets(clonePresetMap(savedPresets))} onSave={savePresetDefaults} onClose={() => setSettingsOpen(false)}/>} 
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
  const pageCount = Math.max(1, Math.ceil(players.length / pageSize))
  useEffect(() => setPage(0), [players])
  const visiblePlayers = players.slice(page * pageSize, (page + 1) * pageSize)
  return <div className="view-stack">
    <div className="page-heading"><div><span className="eyebrow">Database</span><h1>Players</h1></div><span className="result-count">{players.length.toLocaleString()} / {allCount.toLocaleString()}</span></div>
    {allCount === 0 ? <EmptyState/> : <>
      <div className="toolbar">
        <div className="search"><Search size={17}/><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search players, clubs or positions"/></div>
        <button className="secondary" disabled={!players.length} onClick={onCompareAll}><Check size={17}/>{players.length > 0 && players.every((player) => compareIds.includes(player.id)) ? 'Remove all' : 'Select all'}</button>
        {(query || Object.values(filters).some((value) => value !== 'All')) && <button className="text-button" onClick={() => { onQuery(''); onFilters(blankFilters) }}>Clear</button>}
      </div>
      <div className="filters">
        <FilterSelect label="Position" value={filters.position} options={positions} onChange={(position) => onFilters({ ...filters, position })}/>
        <FilterSelect label="Source" value={filters.scope} options={['My squad', 'Scouting', 'Shortlist', 'Player search', 'Other']} onChange={(scope) => onFilters({ ...filters, scope })}/>
        <FilterSelect label="Knowledge" value={filters.knowledge} options={['Exact', 'Ranged', 'Unknown']} onChange={(knowledge) => onFilters({ ...filters, knowledge })}/>
      </div>
      <div className={`database-layout ${selected ? 'detail-open' : ''}`}>
        <div className="table-card"><PlayerTable players={visiblePlayers} selectedId={selected?.id ?? null} compareIds={compareIds} onSelect={onSelect} onCompare={onCompare}/>
          {players.length > pageSize && <div className="pagination"><span>{page + 1} / {pageCount}</span><div><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft size={16}/></button><button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}><ChevronRight size={16}/></button></div></div>}
        </div>
        {selected && <PlayerDetail player={selected} compared={compareIds.includes(selected.id)} onClose={() => onSelect('')} onCompare={() => onCompare(selected.id)}/>} 
      </div>
    </>}
  </div>
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option>All</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>
}

function PlayerTable({ players, selectedId, compareIds, onSelect, onCompare }: { players: Player[]; selectedId: string | null; compareIds: string[]; onSelect: (id: string) => void; onCompare: (id: string) => void }) {
  if (!players.length) return <div className="no-results">No matching players</div>
  return <div className="table-scroll"><table><thead><tr><th>Player</th><th>Position</th><th>Age</th><th>OVR</th><th>Source</th><th>Knowledge</th><th>Value</th><th/></tr></thead>
    <tbody>{players.map((player) => <tr key={player.id} className={selectedId === player.id ? 'selected-row' : ''} onClick={() => onSelect(player.id)} onDoubleClick={() => onCompare(player.id)}>
      <td><strong>{player.name}</strong><span>{player.club}</span></td><td>{player.positions.join(' · ')}</td><td>{player.age ?? '—'}</td><td><Rating value={player.overall}/></td><td>{player.scope}</td><td><Knowledge level={player.knowledge}/></td><td>{formatMoney(player.value)}</td>
      <td><button className={`compare-check ${compareIds.includes(player.id) ? 'checked' : ''}`} title="Toggle comparison" onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCompare(player.id) }}>{compareIds.includes(player.id) ? <Check size={15}/> : '+'}</button></td>
    </tr>)}</tbody></table></div>
}

function Knowledge({ level }: { level: Player['knowledge'] }) { return <span className={`knowledge ${level.toLowerCase()}`}>{level}</span> }
function Rating({ value }: { value: RatingRange | null }) { return <span className={!value ? 'unknown' : value.min !== value.max ? 'range' : ''}>{formatRating(value)}</span> }

function fifaRatingClass(value: RatingRange | null) {
  const point = midpoint(value)
  if (point === null) return 'fifa-unknown'
  if (point > 70) return 'fifa-green'
  if (point > 60) return 'fifa-yellow'
  if (point > 50) return 'fifa-orange'
  return 'fifa-red'
}

function PlayerDetail({ player, compared, onClose, onCompare }: { player: Player; compared: boolean; onClose: () => void; onCompare: () => void }) {
  return <aside className="detail-panel">
    <div className="detail-head"><div><p>{player.positions.join(' · ') || '—'}</p><h2>{player.name}</h2><span>{player.club} · {player.age ?? '—'} · {player.preferredFoot}</span></div><button className="icon-button" onClick={onClose}><X size={19}/></button></div>
    <div className="summary-grid"><div><span>Overall</span><strong>{formatRating(player.overall)}</strong></div><div><span>Value</span><strong>{formatMoney(player.value)}</strong></div><div><span>Wage</span><strong>{formatMoney(player.wage)}</strong></div></div>
    <div className="detail-meta"><Knowledge level={player.knowledge}/><span>{player.scope}</span></div>
    <button className={`wide-button ${compared ? 'selected' : ''}`} onClick={onCompare}>{compared ? <><Check size={16}/>In comparison</> : <>+ Compare</>}</button>
    <section className="fifa-summary"><h3>Summary</h3>{summaryCategories.map((category) => { const value = averageRating(player, category.keys, category.rounding, category.weights); return <div key={category.name}><span>{category.name}</span><strong className={fifaRatingClass(value)}>{formatRating(value)}</strong></div> })}</section>
    <AttributeSections player={player}/>
  </aside>
}

function AttributeSections({ player }: { player: Player }) {
  return <div className="attribute-sections">{attributeGroups.map((group) => <section key={group.name}><h3>{group.name}</h3><div className="attribute-grid">{group.keys.map((key) => <div key={key}><span>{attributeLabels[key]}</span><strong className={fifaRatingClass(player.attributes[key])}>{formatRating(player.attributes[key])}</strong></div>)}</div></section>)}</div>
}

function CompareView({ players, allPlayers, compareIds, preset, mode, roleId, valueIntent, onMode, onRole, onValueIntent, onToggle }: { players: Player[]; allPlayers: Player[]; compareIds: string[]; preset: PositionPreset; mode: 'ALL' | PresetId; roleId: string; valueIntent: ValueIntent; onMode: (id: 'ALL' | PresetId) => void; onRole: (id: string) => void; onValueIntent: (intent: ValueIntent) => void; onToggle: (id: string) => void }) {
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [comparisonView, setComparisonView] = useState<'matrix' | 'ranking'>('matrix')
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false) }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => document.removeEventListener('pointerdown', closeOnOutside)
  }, [])
  useEffect(() => { if (mode === 'ALL') setComparisonView('matrix') }, [mode])
  const relevantKeys = (Object.entries(preset.weights) as [AttributeKey, number][]).filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const pickerNeedle = pickerQuery.trim().toLowerCase()
  const pickerPlayers = pickerNeedle.length < 2 ? [] : allPlayers.filter((player) => playerMatchesSearch(player, pickerQuery)).slice(0, 60)
  return <div className="view-stack compare-view">
    <div className="page-heading"><div><span className="eyebrow">Comparison</span><h1>Compare players</h1>{mode !== 'ALL' && preset.description && <p className="preset-description">{preset.description}</p>}</div><div className="preset-pickers"><div className="comparison-view-switch"><button className={comparisonView === 'matrix' ? 'selected' : ''} onClick={() => setComparisonView('matrix')}><TableProperties size={14}/>Matrix</button><button className={comparisonView === 'ranking' ? 'selected' : ''} disabled={mode === 'ALL'} title={mode === 'ALL' ? 'Choose a position to calculate scores' : 'Rank by calculated score'} onClick={() => setComparisonView('ranking')}><ListOrdered size={14}/>Ranking</button></div><ComparisonModeSelect value={mode} onChange={onMode}/>{mode !== 'ALL' && <RoleSelect position={mode} value={roleId} onChange={onRole}/>}<ValueIntentSelect value={valueIntent} onChange={onValueIntent}/></div></div>
    {allPlayers.length === 0 ? <EmptyState/> : <>
      <div className="compare-picker" ref={pickerRef}><div className="search"><Search size={16}/><input value={pickerQuery} onFocus={() => setPickerOpen(true)} onChange={(event) => { setPickerQuery(event.target.value); setPickerOpen(true) }} placeholder="Add players"/></div><span className="selection-count">{players.length} selected</span>
        {pickerOpen && pickerNeedle.length >= 2 && <div className="compare-options">{pickerPlayers.length ? pickerPlayers.map((player) => <button key={player.id} className={compareIds.includes(player.id) ? 'selected' : ''} onClick={() => { onToggle(player.id); setPickerOpen(false) }}>{compareIds.includes(player.id) && <Check size={13}/>}<span>{player.name}</span><em>{player.club}</em></button>) : <small>No matching players</small>}</div>}
      </div>
      {!players.length ? <div className="empty-state compact"><Users size={28}/><h2>Select players</h2></div> : comparisonView === 'ranking' && mode !== 'ALL' ? <RankingView players={players} preset={preset} valueIntent={valueIntent} onToggle={onToggle}/> : <ComparisonMatrix players={players} preset={preset} mode={mode === 'ALL' ? 'general' : 'position'} relevantKeys={relevantKeys} valueIntent={valueIntent} onToggle={onToggle}/>} 
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

function RankingView({ players, preset, valueIntent, onToggle }: { players: Player[]; preset: PositionPreset; valueIntent: ValueIntent; onToggle: (id: string) => void }) {
  const ranked = [...players].sort((left, right) => (midpoint(scoreForPreset(right, preset).score) ?? -1) - (midpoint(scoreForPreset(left, preset).score) ?? -1))
  const ages = players.map((player) => player.age).filter((age): age is number => age !== null)
  const youngest = ages.length > 1 ? Math.min(...ages) : null
  const oldest = ages.length > 1 ? Math.max(...ages) : null
  const values = players.map((player) => player.value)
  return <div className="ranking-card"><div className="ranking-head"><span>Rank</span><span>Player</span><span>Score</span><span>Age</span><span>Value</span><span/></div>{ranked.map((player, index) => {
    const ageClass = youngest !== null && youngest !== oldest && player.age === youngest ? 'best' : oldest !== null && youngest !== oldest && player.age === oldest ? 'worst' : ''
    return <div className="ranking-row" key={player.id}><strong className="rank-number">{index + 1}</strong><div className="ranking-player"><div className="player-avatar">{player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</div><div><strong>{player.name}</strong><span>{player.positions.join(' · ')} · {player.club}</span></div></div><strong className="ranking-score">{formatRating(scoreForPreset(player, preset).score)}</strong><strong className={`ranking-age ${ageClass}`}>{player.age ?? '—'}</strong><strong className={`ranking-value ${valueComparisonClass(player.value, values, valueIntent)}`}>{formatMoney(player.value)}</strong><button aria-label={`Remove ${player.name} from comparison`} title="Remove from comparison" onClick={() => onToggle(player.id)}><X size={15}/></button></div>
  })}</div>
}

function ComparisonMatrix({ players, preset, mode, relevantKeys, valueIntent, onToggle }: { players: Player[]; preset: PositionPreset; mode: 'general' | 'position'; relevantKeys: AttributeKey[]; valueIntent: ValueIntent; onToggle: (id: string) => void }) {
  const [focusedRow, setFocusedRow] = useState<string | null>(null)
  const overallValues = players.map((player) => player.overall)
  const scoreValues = players.map((player) => scoreForPreset(player, preset).score)
  const gridStyle = { '--players': players.length } as React.CSSProperties
  const focus = (row: string) => setFocusedRow((current) => current === row ? null : row)
  const rowClass = (row: string) => focusedRow === row ? 'row-focused' : ''
  return <div className="comparison-card"><div className="comparison-frame" style={gridStyle}>
    <div className="comparison-grid comparison-header" style={gridStyle}><div className="comparison-label corner-cell">Attribute</div>{players.map((player) => <div className="comparison-player" key={player.id}><button aria-label={`Remove ${player.name} from comparison`} title="Remove from comparison" onClick={() => onToggle(player.id)}><X size={14}/></button><div className="player-avatar">{player.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</div><strong>{player.name}</strong><span>{player.positions.join(' · ')}</span><em>{player.club}</em></div>)}</div>
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
    return <div className={`comparison-value ${className} ${focusedClass}`} onClick={() => onFocus('value')} key={player.id}>{formatMoney(values[index])}</div>
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

function RoleSelect({ position, value, onChange }: { position: PresetId; value: string; onChange: (id: string) => void }) {
  return <div className="select-wrap role-select"><select aria-label="Player type" value={value} onChange={(event) => onChange(event.target.value)}><option value="GENERAL">General</option>{rolePresets[position].map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><ChevronDown size={15}/></div>
}

function SettingsPanel({ presets, presetId, roleId, onPreset, onRole, onWeight, onFactoryReset, onSavedReset, onSave, onClose }: { presets: PresetMap; presetId: PresetId; roleId: string; onPreset: (id: PresetId) => void; onRole: (id: string) => void; onWeight: (key: AttributeKey, value: number) => void; onFactoryReset: () => void; onSavedReset: () => void; onSave: () => void; onClose: () => void }) {
  const preset = presets[roleId === 'GENERAL' ? presetId : roleId]
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="settings-panel">
    <div className="settings-head"><div><span className="eyebrow">Preset settings</span><h2>{preset.name}</h2></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <div className="settings-toolbar"><div className="preset-pickers"><PresetSelect value={presetId} onChange={onPreset}/><RoleSelect position={presetId} value={roleId} onChange={onRole}/></div>{preset.description && <p className="preset-description">{preset.description}</p>}</div>
    <div className="weight-list">{attributeGroups.map((group) => <section key={group.name}><h3>{group.name}</h3>{group.keys.map((key) => <label key={key}><span>{attributeLabels[key]}</span><input type="range" min="0" max="10" value={preset.weights[key] ?? 0} onChange={(event) => onWeight(key, Number(event.target.value))}/><input className="weight-number" type="number" min="0" max="10" value={preset.weights[key] ?? 0} onChange={(event) => onWeight(key, Number(event.target.value))}/></label>)}</section>)}</div>
    <div className="settings-actions"><div><button className="secondary" onClick={onFactoryReset}>Factory defaults</button><button className="secondary" onClick={onSavedReset}>Reset to saved</button></div><div><button className="text-button" onClick={onClose}>Close</button><button className="primary" onClick={() => { onSave(); onClose() }}>Save as default</button></div></div>
  </div></div>
}

export default App
