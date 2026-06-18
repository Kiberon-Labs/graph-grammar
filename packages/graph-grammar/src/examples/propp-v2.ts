import type { Grammar, Rule, Graph, PropPredicate, PropExpr, RhsNode, RhsEdge, EmbeddingRule } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, counter, copyProp } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ===========================================================================
// Propp's Morphology , v2: the CONCRETE tale.
//
// v1 (see ./propp.ts) is a frontier state-machine: a `Tale` node walks Propp's
// fixed-order alphabet of functions and splices one ABSTRACT step per phase
// (β Absentation, A Villainy, K Liquidation, …). The result is a structurally
// perfect but bloodless skeleton , "a family member absents themselves".
//
// v2 keeps that skeleton-builder verbatim as PASS 1, then adds a SECOND,
// LOWER-PRIORITY PASS that knits the skeleton into a concrete, coherent story
// using a randomly-seeded cast of the world's facts:
//
//   • WORLD SEED. The start graph carries an over-sized pool of world facts ,
//     CastChar (people, tagged with a `role` and a `relation` to the hero),
//     CastItem (objects, tagged by `kind`), and CastPlace (locations). Because
//     the pool is larger than any one tale needs, each seed draws a different
//     cast: a different elder dies, a different villain strikes.
//
//   • PASS 1 , STRUCTURE. v1's rules, unchanged except for one thing: the
//     three "consuming" rules (Liquidation K, Punishment U, Exposure Ex) no
//     longer DELETE the lack / villain / false-hero. They MARK them resolved
//     (`liquidated`, `punished`, `exposed`) and keep them on the board, so the
//     persistent entities survive to be named and referenced in pass 2.
//
//   • PASS 2a , CASTING. Once the `Tale` frontier dissolves (structure done),
//     casting rules bind cast members to the persistent entities: which villain
//     struck, which kin was taken, which rival set out. The hero's RELATION to
//     the cast is what selects them , exactly the "use relationships to the
//     hero to determine which elder leaves" idea. Two extra layers ride here:
//       – THE ROUTE. Four `Location` stops (home → gateway → wilds → lair) are
//         cast from the place pool and joined by `road` edges; the Hero sits
//         `at` home. Every travel beat (Departure/Guidance/Return/Pursuit)
//         references consecutive legs, so the journey is spatially coherent and
//         visible in the graph , leave home, out the gateway, across the wilds
//         to the lair, fight, back through the wilds, chased to the gateway,
//         home for the wedding.
//       – THE SOCIAL WEB. The cast pool carries directed `rel` edges (kin /
//         beloved / covets / claims / sibling / rival). Casting PREFERS members
//         linked in the web (NAC-gated fallbacks keep it from picking unrelated
//         ones while a tie is available), so the principals hang together: this
//         hero's own betrothed, the villain who covets her, the rival who is
//         his brother. The tie is recorded as a `bondType` (+ a visible `kin`
//         edge) and relationship-gated prose variants bake it into the telling.
//
//   • PASS 2b , FLESHING. For every abstract function node, one of several
//     HAND-AUTHORED scenario variants fires, writing concrete prose (with
//     {slot} placeholders) and optionally pulling in a fresh minor character,
//     item, or place from the pool. The variants are the creative payload:
//     interdiction → "leaves the village gate open at night" / "touches the
//     protection-stone" / "eats the lamb meant for the gods".
//
//   • THE TWO-PASS GATE. Every casting & fleshing rule carries a NAC on the
//     `Tale` node. While the structural frontier still walks, NONE of them can
//     fire; the instant it dissolves, they take over. That single constraint is
//     what makes pass 2 strictly "lower-priority / second" without abandoning
//     the stochastic `random` strategy that gives pass 1 its variety.
//
//   • OUTPUT. narrateTale() walks the finished `then`-chain in order, fills
//     each step's prose template from its own props, and returns the tale as
//     readable text , the concrete story, not the abstract function list.
//
// Run it, step through, and watch the skeleton assemble and then take on flesh.
// ===========================================================================

// Phase names = Propp's read-head (identical to v1).
const P = {
  absent: 'absentation',
  interdict: 'interdiction',
  recon: 'reconnaissance',
  villainy: 'villainy',
  mediation: 'mediation',
  counter: 'counteraction',
  departure: 'departure',
  donor: 'donor',
  guidance: 'guidance',
  climax: 'climax',
  liquidation: 'liquidation',
  rtn: 'return',
  pursuit: 'pursuit',
  recognition: 'recognition',
  punishment: 'punishment',
  wedding: 'wedding',
  done: 'done',
} as const

// ---------------------------------------------------------------------------
// THE CONCRETIZATION FORMAT (the surface creative writers fill).
//
// A `Scenario` is a hand-authored realisation of one Propp function. It names
// the abstract step it fleshes out (`target`, the function node's label), a
// prose `text` template with {slot} placeholders, and an optional list of
// `binds` , world facts to pull in and copy into slots. Everything a writer
// needs is data; the rule machinery is generated by `flesh()` below.
// ---------------------------------------------------------------------------
export interface Bind {
  /** Local pattern id (unique within the scenario). */
  id: string;
  /** Node label to match: a persistent entity ("Hero", "Villain", "Lack",
   *  "FalseHero", "Agent") or a pool fact ("CastChar", "CastItem", "CastPlace"). */
  label: string;
  /** Selection predicates (e.g. role / relation / kind / cast flag). */
  where?: PropPredicate[];
  /** slotName -> prop key on the bound node, copied onto the step's props. */
  copy: Record<string, string>;
  /** If true, the bound fact is removed from the pool once used. */
  consume?: boolean;
  /** If set (and not consumed), add an edge step->fact with this label. */
  link?: string;
}

export interface Scenario {
  /** The function node label this realises (e.g. "Interdiction"). */
  target: string;
  /** Prose template; {slot} placeholders are filled from the step's props. */
  text: string;
  /** Relative weight among variants for the same target. */
  weight?: number;
  /** World facts to bind and copy into slots. */
  binds?: Bind[];
  /** Negative conditions: this variant only fires when NONE of these match.
   *  (label + optional where; only the shape is used.) Lets a variant be gated,
   *  e.g. a bare-handed victory that requires "no Agent present". */
  forbid?: Array<{ label: string; where?: PropPredicate[] }>;
}

// -- Bind helpers (the documented menu the scenarios draw from). -------------
// Entity references: copy a persistent entity's concrete (cast) identity into
// slots. They require `cast: true`, so casting always runs before a step that
// names the entity.
const refHero = (): Bind => ({ id: '_hero', label: 'Hero', where: [{ key: 'cast', op: 'eq', value: true }], copy: { hero: 'name', heroEpithet: 'epithet' } })
const refVillain = (): Bind => ({ id: '_vil', label: 'Villain', where: [{ key: 'cast', op: 'eq', value: true }], copy: { villain: 'name', villainEpithet: 'epithet' } })
const refPrincess = (): Bind => ({ id: '_lack', label: 'Lack', where: [{ key: 'cast', op: 'eq', value: true }], copy: { princess: 'of', princessEpithet: 'victimEpithet', princessRelation: 'victimRelation' } })
const refRival = (): Bind => ({ id: '_riv', label: 'FalseHero', where: [{ key: 'cast', op: 'eq', value: true }], copy: { rival: 'name', rivalEpithet: 'epithet' } })
const refAgent = (): Bind => ({ id: '_ag', label: 'Agent', where: [{ key: 'cast', op: 'eq', value: true }], copy: { agent: 'name', agentEpithet: 'epithet' } })

// Relationship-gated entity refs: like refVillain/refRival, but only match when
// the entity carries a specific social-web `bondType` (set at casting). A prose
// variant that uses one only fires when that tie was drawn , so the wording can
// bake the relationship in ("who had long coveted her", "the hero's brother").
const refVillainBond = (kind: string): Bind => ({ id: '_vil', label: 'Villain', where: [{ key: 'cast', op: 'eq', value: true }, { key: 'bondType', op: 'eq', value: kind }], copy: { villain: 'name', villainEpithet: 'epithet' } })
const refRivalBond = (kind: string): Bind => ({ id: '_riv', label: 'FalseHero', where: [{ key: 'cast', op: 'eq', value: true }, { key: 'bondType', op: 'eq', value: kind }], copy: { rival: 'name', rivalEpithet: 'epithet' } })

// Itinerary-stop refs: name one of the four cast journey stops (home, gateway,
// wilds, lair) , see the Location-casting rules. They are NOT consumed (a stop
// can be referenced by several beats). Pass a `link` (e.g. "traverses") to draw
// an edge from the step to the stop it moves to, making the route visible.
const stopBind = (role: string, link?: string): Bind => ({
  id: `_${role}`,
  label: 'Location',
  where: [{ key: 'role', op: 'eq', value: role }, { key: 'cast', op: 'eq', value: true }],
  copy: { [role]: 'name', [`${role}Epithet`]: 'epithet' },
  ...(link ? { link } : {}),
})
const refHome = (link?: string): Bind => stopBind('home', link)
const refGateway = (link?: string): Bind => stopBind('gateway', link)
const refWilds = (link?: string): Bind => stopBind('wilds', link)
const refLair = (link?: string): Bind => stopBind('lair', link)

/** Pull in (and consume) a minor character by role and/or relation-to-hero.
 *  Exposes slots {slot}, {slot}Epithet, {slot}Relation. */
function bindMinor (slot: string, opts: { roles?: string[]; relations?: string[] } = {}): Bind {
  const where: PropPredicate[] = []
  if (opts.roles) where.push({ key: 'role', op: 'in', value: opts.roles })
  if (opts.relations) where.push({ key: 'relation', op: 'in', value: opts.relations })
  return { id: `c_${slot}`, label: 'CastChar', where, copy: { [slot]: 'name', [`${slot}Epithet`]: 'epithet', [`${slot}Relation`]: 'relation' }, consume: true }
}

/** Pull in a place by kind. Exposes {slot}, {slot}Epithet. Not consumed (places
 *  can recur). */
function bindPlace (slot: string, kinds?: string[]): Bind {
  const where: PropPredicate[] = kinds ? [{ key: 'kind', op: 'in', value: kinds }] : []
  return { id: `p_${slot}`, label: 'CastPlace', where, copy: { [slot]: 'name', [`${slot}Epithet`]: 'epithet' } }
}

/** Pull in (and by default consume) an item by kind. Exposes {slot}, {slot}Epithet. */
function bindItem (slot: string, kinds?: string[], consume = true): Bind {
  const where: PropPredicate[] = kinds ? [{ key: 'kind', op: 'in', value: kinds }] : []
  return { id: `i_${slot}`, label: 'CastItem', where, copy: { [slot]: 'name', [`${slot}Epithet`]: 'epithet' }, consume }
}

// ---------------------------------------------------------------------------
// flesh(): turn one Scenario into a pass-2 rewrite rule.
//   LHS  = the un-fleshed target step (text absent) + each bound fact.
//   RHS  = the same step, now carrying the prose template + copied slot props.
//   NAC  = the Tale frontier (so this can only fire AFTER pass 1 completes).
//   embedding = remove every consumed fact from the pool.
// ---------------------------------------------------------------------------
function flesh (scn: Scenario, ord: number): Rule {
  const T = 't0'
  const lhsNodes = [pn(T, scn.target, { predicates: [{ key: 'text', op: 'absent' }] })]
  const setProps: Record<string, PropExpr> = { text: lit(scn.text), fleshed: lit(true) }
  const rhsNodes: RhsNode[] = []
  const rhsEdges: RhsEdge[] = []
  const embeddings: EmbeddingRule[] = []

  for (const b of scn.binds ?? []) {
    lhsNodes.push(pn(b.id, b.label, { predicates: b.where }))
    for (const [slot, key] of Object.entries(b.copy)) setProps[slot] = copyProp(b.id, key)
    if (b.consume) {
      embeddings.push(emb(b.id, 'remove'))
    } else {
      rhsNodes.push(rn(b.id, b.label, { mapFrom: b.id }))
      if (b.link) rhsEdges.push(re(`lk_${b.id}`, T, b.id, { label: b.link, directed: true }))
    }
  }
  rhsNodes.unshift(rn(T, scn.target, { mapFrom: T, setProps }))

  // NAC: the Tale frontier (pass-2 gate) plus any author-declared `forbid`
  // conditions. Each NAC pattern is matched globally (engine.nacBlocked), so a
  // single forbidden node anywhere blocks the variant.
  const nac = [{ nodes: [pn('_tale', 'Tale')], edges: [] }];
  (scn.forbid ?? []).forEach((f, k) => nac.push({ nodes: [pn(`_no${k}`, f.label, { predicates: f.where })], edges: [] }))

  return rule({
    name: `✎ ${scn.target} · v${ord}`,
    description: scn.text,
    color: '#9c36b5',
    group: 'Concretize',
    weight: scn.weight ?? 1,
    lhs: { nodes: lhsNodes, edges: [] },
    rhs: { nodes: rhsNodes, edges: rhsEdges },
    nac,
    embedding: embeddings.length ? embeddings : undefined,
  })
}

// ===========================================================================
// THE CAST POOL. Over-sized on purpose: casting/fleshing consume a subset, so
// each seed draws a different tale. Casting roles (hero/villain/victim/rival)
// are kept disjoint from minor roles (elder/commoner/…) so the two never starve
// each other.
// ===========================================================================
interface CastCharSpec { name: string; role: string; relation: string; epithet: string; }
const CAST_CHARS: CastCharSpec[] = [
  // -- protagonists (consumed by hero-casting) --
  { name: 'Ivan', role: 'hero', relation: 'self', epithet: 'the youngest son' },
  { name: 'Alyosha', role: 'hero', relation: 'self', epithet: "the soldier's boy" },
  { name: 'Dobrynya', role: 'hero', relation: 'self', epithet: "the smith's apprentice" },
  // -- villains --
  { name: 'Koschei the Deathless', role: 'villain', relation: 'none', epithet: 'whose death hides in an egg' },
  { name: 'the Sea-Tsar', role: 'villain', relation: 'none', epithet: 'lord of the drowned halls' },
  { name: 'Baba Yaga', role: 'villain', relation: 'none', epithet: 'who rides the iron mortar' },
  { name: 'the Dragon Gorynych', role: 'villain', relation: 'none', epithet: 'of the three burning heads' },
  // -- the taken (the Lack's victim) --
  { name: 'Vasilisa', role: 'victim', relation: 'sister', epithet: 'the fair' },
  { name: 'Yelena', role: 'victim', relation: 'betrothed', epithet: 'the wise' },
  { name: 'Marya Morevna', role: 'victim', relation: 'betrothed', epithet: 'the warrior-queen' },
  // -- rivals (the false hero) --
  { name: 'the water-carrier', role: 'rival', relation: 'none', epithet: 'with the borrowed sword' },
  { name: "the boyar's son", role: 'rival', relation: 'none', epithet: "in his father's furs" },
  { name: 'the cook', role: 'rival', relation: 'none', epithet: 'who smelled of smoke' },
  // -- minor elders (consumed by absentation, etc.) --
  { name: 'Marfa', role: 'elder', relation: 'grandmother', epithet: 'the keeper of the hearth' },
  { name: 'Yegor', role: 'elder', relation: 'grandfather', epithet: 'the old huntsman' },
  { name: 'Stepan', role: 'elder', relation: 'father', epithet: 'the headman' },
  { name: 'Darya', role: 'elder', relation: 'mother', epithet: 'the weaver' },
  { name: 'the hermit', role: 'elder', relation: 'mentor', epithet: 'who reads the stars' },
  // -- commoners / specialists (minor flavour) --
  { name: 'the swineherd', role: 'commoner', relation: 'none', epithet: 'always last to bed' },
  { name: "the miller's daughter", role: 'commoner', relation: 'none', epithet: 'with flour in her hair' },
  { name: 'the night-watchman', role: 'guardian', relation: 'none', epithet: 'fond of his cup' },
  { name: 'the ferryman', role: 'commoner', relation: 'none', epithet: 'who knows the fords' },
  { name: 'the gatekeeper', role: 'guardian', relation: 'none', epithet: 'of the old oak doors' },
  { name: 'the village priest', role: 'priest', relation: 'none', epithet: 'who tends the shrine' },
]

interface CastItemSpec { name: string; kind: string; epithet: string; }
const CAST_ITEMS: CastItemSpec[] = [
  { name: 'a firebird feather', kind: 'talisman', epithet: 'that burns without heat' },
  { name: 'an enchanted ring', kind: 'talisman', epithet: 'warm to a true hand' },
  { name: 'a sword of light', kind: 'weapon', epithet: 'forged in star-fall' },
  { name: 'a self-swinging axe', kind: 'weapon', epithet: 'that never misses' },
  { name: 'the icon of the saint', kind: 'relic', epithet: 'weeping silver' },
  { name: 'the sacrificial lamb', kind: 'food', epithet: 'promised to the gods' },
  { name: 'the last loaf', kind: 'food', epithet: 'blessed at midwinter' },
  { name: 'a ball of magic yarn', kind: 'tool', epithet: 'that rolls to its master' },
  { name: 'a flying carpet', kind: 'tool', epithet: 'woven in Samarkand' },
]

interface CastPlaceSpec { name: string; kind: string; epithet: string; }
// Kinds map onto the four journey roles cast by the Location rules:
//   home → village · gateway → gate/bridge · wilds → forest/river/field · lair → cave/mountain.
// The rest (shrine/well/hall) and the spare gate stay in the pool for decorative
// `bindPlace` flavour, so the itinerary never starves the violation/wedding beats.
const CAST_PLACES: CastPlaceSpec[] = [
  { name: 'the village of Tikhomirovo', kind: 'village', epithet: "at the forest's edge" },
  { name: 'the riverside hamlet', kind: 'village', epithet: 'of seven chimneys' },
  { name: 'the village gate', kind: 'gate', epithet: 'of the old oak doors' },
  { name: 'the postern gate', kind: 'gate', epithet: 'behind the chapel' },
  { name: 'the Kalinov bridge', kind: 'bridge', epithet: 'between the living and the dead' },
  { name: 'the dark forest', kind: 'forest', epithet: 'where no birds sing' },
  { name: 'the Smorodina river', kind: 'river', epithet: 'of currants and fire' },
  { name: 'the rye field', kind: 'field', epithet: 'gold to the horizon' },
  { name: "the dragon's cave", kind: 'cave', epithet: 'stinking of sulphur' },
  { name: 'the glass mountain', kind: 'mountain', epithet: 'no horse can climb' },
  { name: 'the protection-stone shrine', kind: 'shrine', epithet: 'ringed with rowan' },
  { name: 'the old well', kind: 'well', epithet: 'whose bottom no rope finds' },
  { name: "the prince's hall", kind: 'hall', epithet: 'hung with banners' },
]

// ===========================================================================
// SCENARIO LIBRARY. Grouped by Propp section. These are the hand-authored
// realisations , the creative payload. Each function label needs at least one
// no-consume "fallback" variant so it always fleshes even if the pool is dry.
// (Sections PREP / COMPLICATION / TRIALS / RESOLUTION are authored separately.)
// ===========================================================================

// --- PREPARATION: α initial · β absentation · γ/δ interdiction · ε recon ---
// (Authored in the voice of a village chronicler.)
const PREP_SCENARIOS: Scenario[] = [
  // α , Initial situation. refHero (+ optionally the home stop). No villain yet.
  { target: 'InitialSituation', weight: 3, text: 'In {home}, {homeEpithet}, lived {hero}, {heroEpithet}, in a low house with the forest at its back.', binds: [refHero(), refHome()] },
  { target: 'InitialSituation', weight: 2, text: 'At {home}, {homeEpithet}, dwelt {hero}, {heroEpithet}, who asked little of the wide world.', binds: [refHero(), refHome()] },
  { target: 'InitialSituation', weight: 2, text: 'In a kingdom beyond thrice-nine lands lived {hero}, {heroEpithet}, in a low house at the edge of the village.', binds: [refHero()] },
  { target: 'InitialSituation', weight: 2, text: 'Once, where the river bends and the forest leans close, there dwelt {hero}, {heroEpithet}.', binds: [refHero()] },
  { target: 'InitialSituation', weight: 2, text: 'In a certain village, neither near nor far, {hero} kept the household and asked little of the wide world.', binds: [refHero()] },
  { target: 'InitialSituation', weight: 1, text: '{hero}, {heroEpithet}, was raised on black bread and old songs, and knew every path the geese took.', binds: [refHero()] },
  { target: 'InitialSituation', weight: 2, text: 'There once lived {hero}, and the cottage was warm and the gate was barred, and no sorrow had yet found the door.', binds: [refHero()] },

  // β , Absentation (succession): the elder's RELATION to the hero decides who leaves/dies.
  { target: 'Absentation', weight: 3, text: "When the snows came, {hero}'s {elderRelation}, {elder}, {elderEpithet}, took to bed, and by spring lay still beneath the rowan.", binds: [refHero(), bindMinor('elder', { roles: ['elder'], relations: ['grandmother', 'grandfather'] })] },
  { target: 'Absentation', weight: 3, text: "{hero}'s {elderRelation}, {elder}, saddled the grey horse at dawn and rode off beyond the fields, and the gate stood open behind.", binds: [refHero(), bindMinor('elder', { roles: ['elder'], relations: ['father'] })] },
  { target: 'Absentation', weight: 2, text: "A summons came from the prince, and {hero}'s {elderRelation}, {elder}, {elderEpithet}, went to answer it, leaving the house in younger hands.", binds: [refHero(), bindMinor('elder', { roles: ['elder'], relations: ['father', 'mother'] })] },
  { target: 'Absentation', weight: 2, text: "One morning {hero}'s {elderRelation}, {elder}, {elderEpithet}, was simply gone, and the cell by the wood stood cold.", binds: [refHero(), bindMinor('elder', { roles: ['elder'], relations: ['mentor'] })] },
  { target: 'Absentation', weight: 2, text: "Then {hero}'s {elderRelation}, {elder}, kissed the children's heads, spoke a last blessing, and passed before the candle guttered out.", binds: [refHero(), bindMinor('elder', { roles: ['elder'], relations: ['mother', 'grandmother'] })] },
  { target: 'Absentation', weight: 1, text: "The elders rode out to the fair three days' travel away, and the household was left to mind itself.", binds: [refHero()] },

  // γ/δ , Interdiction & its violation (hand-authored breaches).
  { target: 'Interdiction', weight: 3, text: 'Bar the gate of {place} at nightfall and on no account open it, they warned {who}, {whoEpithet} , yet {who} left it swinging in the dark.', binds: [refHero(), bindMinor('who', { roles: ['guardian'] }), bindPlace('place', ['gate'])] },
  { target: 'Interdiction', weight: 3, text: 'Never lay a hand on {item} that guards {place}, the old folk said , but {who}, {whoEpithet}, reached out and lifted it from its place.', binds: [refHero(), bindMinor('who', { roles: ['priest'] }), bindItem('item', ['relic', 'talisman']), bindPlace('place', ['shrine'])] },
  { target: 'Interdiction', weight: 2, text: '{item} on the threshold of {place} was set aside for the old gods, and not to be touched , yet hungry {who} ate of it before the lamps were lit.', binds: [refHero(), bindMinor('who', { roles: ['commoner'] }), bindItem('item', ['food']), bindPlace('place', ['shrine'])] },
  { target: 'Interdiction', weight: 2, text: 'Draw no water from {place} after dark and leave the cover stone in its place, {who} was told , but {who}, {whoEpithet}, rolled the stone aside all the same.', binds: [refHero(), bindMinor('who', { roles: ['guardian'] }), bindPlace('place', ['well'])] },
  { target: 'Interdiction', weight: 2, text: 'Keep the door of {place} fast against the night and answer no knock, warned the elders , but {who} slid the bolt back to listen at the crack.', binds: [refHero(), bindMinor('who', { roles: ['commoner'] }), bindPlace('place', ['hall'])] },
  { target: 'Interdiction', weight: 1, text: 'There was one rule above all: bar the gate at dusk. That night the gate was left unbarred, and the dark came leaning in.', binds: [refHero()] },

  // ε , Reconnaissance: the villain first appears, scouting (down from its lair).
  { target: 'Reconnaissance', weight: 3, text: 'Down from {lair}, {lairEpithet}, came {villain}, {villainEpithet}, scouting the edge of the fields and asking what the household guarded.', binds: [refVillain(), refLair()] },
  { target: 'Reconnaissance', weight: 2, text: 'Then {villain}, {villainEpithet}, came scouting to the edge of the fields, asking after the household and what it guarded.', binds: [refVillain()] },
  { target: 'Reconnaissance', weight: 2, text: 'By {place} a stranger lingered, and it was {villain}, {villainEpithet}, counting the windows and listening for whose breath slept where.', binds: [refVillain(), bindPlace('place', ['bridge', 'gate', 'well'])] },
  { target: 'Reconnaissance', weight: 2, text: '{villain}, {villainEpithet}, circled the village three times in the shape of a crow, marking the door left open and the hearth left untended.', binds: [refVillain()] },
  { target: 'Reconnaissance', weight: 2, text: 'A cold wind came down from {place}, and on it rode {villain}, {villainEpithet}, sniffing out the dearest thing the house held.', binds: [refVillain(), bindPlace('place', ['forest', 'cave', 'river'])] },
  { target: 'Reconnaissance', weight: 1, text: '{villain} watched from the treeline until the last candle died, learning the ways of the house and who would be alone.', binds: [refVillain()] },
]

// --- COMPLICATION: A villainy · B mediation · C counteraction · ↑ departure ---
// (Authored in the voice of a war-bard.)
const COMPLICATION_SCENARIOS: Scenario[] = [
  // A , Villainy: the inciting harm. The taken one is borne off to the lair.
  // Generic variants forbid a villain that carries a social-web bondType, so the
  // relationship-gated variants below win whenever such a tie was drawn.
  { target: 'Villainy', weight: 2, text: 'While the household slept {villain}, {villainEpithet}, came on a black wind, snatched up {princess}, {princessEpithet}, and bore her away to {lair}, beyond the thrice-ninth land.', binds: [refVillain(), refPrincess(), refLair('traverses')], forbid: [{ label: 'Villain', where: [{ key: 'bondType', op: 'exists' }] }] },
  { target: 'Villainy', text: "At the grey hour before dawn {villain} broke the bolts of the house and carried off {princess}, {hero}'s {princessRelation}, {princessEpithet}, away to {lair}, from which none return.", binds: [refVillain(), refHero(), refPrincess(), refLair('traverses')], forbid: [{ label: 'Villain', where: [{ key: 'bondType', op: 'exists' }] }] },
  { target: 'Villainy', text: 'Out of the whirlwind came {villain}, {villainEpithet}, and where {princess}, {princessEpithet}, had stood there was only a cold print in the dust , she was gone to {lair}.', binds: [refVillain(), refPrincess(), refLair('traverses')], forbid: [{ label: 'Villain', where: [{ key: 'bondType', op: 'exists' }] }] },
  // Relationship-gated: the villain's tie to the taken one becomes the motive.
  { target: 'Villainy', weight: 2, text: '{villain}, who had long coveted {princess}, {princessEpithet}, swept down like a storm-cloud and bore her off to {lair}.', binds: [refVillainBond('covets'), refPrincess(), refLair('traverses')] },
  { target: 'Villainy', weight: 2, text: '{villain}, who claimed {princess} by an old and bitter bargain, came for her at last and carried her to {lair}.', binds: [refVillainBond('claims'), refPrincess(), refLair('traverses')] },
  { target: 'Villainy', weight: 2, text: "{villain}, {princess}'s own faithless kin, stole her from the very threshold and shut her away in {lair}.", binds: [refVillainBond('kin'), refPrincess(), refLair('traverses')] },

  // B , Mediation: the misfortune is made known; the hero is dispatched.
  { target: 'Mediation', weight: 2, text: 'The cry went up through the land, and {hero}, {heroEpithet}, heard it and knew the loss was his own to mend.', binds: [refHero()] },
  { target: 'Mediation', text: 'Out of the dark came {messenger}, {messengerEpithet}, breathless and torn, who fell at the feet of {hero} and told him all that had befallen.', binds: [refHero(), bindMinor('messenger', { roles: ['commoner', 'guardian', 'priest'] })] },
  { target: 'Mediation', weight: 2, text: '{messenger}, {messengerEpithet}, came riding with the bitter news, and {hero}, {heroEpithet}, rose from the bench the moment he had heard it.', binds: [refHero(), bindMinor('messenger', { roles: ['commoner', 'guardian', 'priest'] })] },
  { target: 'Mediation', text: 'Word of {princess}, {princessEpithet}, and her stealing-away reached {hero}, and his heart turned to stone and fire at once.', binds: [refHero(), refPrincess()] },
  { target: 'Mediation', text: 'They sent for {hero}, {heroEpithet}, from the far end of the kingdom, saying that none but he could set the wrong to rights.', binds: [refHero()] },

  // C , Counteraction: the hero resolves to go.
  { target: 'Counteraction', weight: 2, text: '{hero}, {heroEpithet}, struck the table with his fist and swore he would not eat bread nor sleep beneath a roof until the wrong was undone.', binds: [refHero()] },
  { target: 'Counteraction', text: 'Then {hero} bowed to the four corners of the world and vowed aloud to bring back {princess}, {princessEpithet}, or never to return at all.', binds: [refHero(), refPrincess()] },
  { target: 'Counteraction', weight: 2, text: '"Better my head should fall than that I sit idle," said {hero}, {heroEpithet}, and so he resolved to go.', binds: [refHero()] },
  { target: 'Counteraction', text: '{hero}, {heroEpithet}, girded himself in silence, for he had set his heart on the road and no word could turn him from it.', binds: [refHero()] },
  { target: 'Counteraction', text: 'Let the way be long as it likes, swore {hero}, he would walk it to the end and bring {princess}, {princessEpithet}, home again.', binds: [refHero(), refPrincess()] },

  // ↑ , Departure: the hero leaves home (the first leg, home → gateway).
  { target: 'Departure', weight: 2, text: 'At first light {hero}, {heroEpithet}, bowed to {home} and rode out by {gateway}, {gatewayEpithet}, into the open road.', binds: [refHero(), refHome(), refGateway('traverses')] },
  { target: 'Departure', text: '{hero} passed out through {gateway}, {gatewayEpithet}, and turned his face toward the unknown, and {home} sank below the rim of the world behind him.', binds: [refHero(), refHome(), refGateway('traverses')] },
  { target: 'Departure', weight: 2, text: 'So {hero}, {heroEpithet}, left {home} and took the road past {gateway}, where no traveller had told the way.', binds: [refHero(), refHome(), refGateway('traverses')] },
  { target: 'Departure', text: 'Without a backward glance {hero} crossed {gateway}, {gatewayEpithet}, and went on into the wide and roadless world.', binds: [refHero(), refGateway('traverses')] },
]

// --- TRIALS: F receipt · G guidance · H struggle · J victory · M/N task ---
// (Authored in the voice of a wandering minstrel.)
const TRIALS_SCENARIOS: Scenario[] = [
  // F , Receipt of the magical agent (the donor sequence). Every variant names the agent.
  { target: 'ReceiveAgent', weight: 1, text: "By a crooked road {hero} came on {donor}, {donorEpithet}, who said, 'Feed me, warm me, speak me kindly,' and, being well served, pressed {agent}, {agentEpithet}, into the hero's hand.", binds: [refHero(), refAgent(), bindMinor('donor', { roles: ['elder'] })] },
  { target: 'ReceiveAgent', weight: 1, text: '{donor}, {donorEpithet}, set three riddles before {hero}, and when each was answered true gave over {agent}, {agentEpithet}, won by wit and not by chance.', binds: [refHero(), refAgent(), bindMinor('donor', { roles: ['elder', 'priest'] })] },
  { target: 'ReceiveAgent', weight: 1, text: 'An old crone barred the way until {hero} swept her hut and tended her fire; only then did she yield {agent}, {agentEpithet}, from beneath the stove.', binds: [refHero(), refAgent()] },
  { target: 'ReceiveAgent', weight: 1, text: '{hero} drew a thorn from the paw of a grey beast on the road, and in thanks it bore back {agent}, {agentEpithet}, in its jaws.', binds: [refHero(), refAgent()] },
  { target: 'ReceiveAgent', weight: 1, text: '{donor}, {donorEpithet}, watched how {hero} shared the last crust with a stranger, and so judged the hero worthy of {agent}, {agentEpithet}.', binds: [refHero(), refAgent(), bindMinor('donor', { roles: ['commoner', 'elder'] })] },
  { target: 'ReceiveAgent', weight: 1, text: 'Deep in a smoking forge {hero} laboured a year and a day for {donor}, {donorEpithet}, and at the term was paid not in coin but in {agent}, {agentEpithet}.', binds: [refHero(), refAgent(), bindMinor('donor', { roles: ['elder', 'commoner'] })] },

  // G , Guidance: the hero is led across the wilds to the villain's lair.
  { target: 'Guidance', weight: 1, text: 'Through {wilds}, {wildsEpithet}, {hero} pressed on until the road ended at {lair}, {lairEpithet}, where the villain kept its hoard.', binds: [refHero(), refWilds(), refLair('traverses')] },
  { target: 'Guidance', weight: 1, text: 'A grey wolf took {hero} on its back across {wilds} and set the hero down at {lair}, {lairEpithet}.', binds: [refHero(), refWilds(), refLair('traverses')] },
  { target: 'Guidance', weight: 1, text: 'A ball of yarn rolled before {hero} through {wilds}, {wildsEpithet}, and where it unwound to nothing stood {lair}, {lairEpithet}.', binds: [refHero(), refWilds(), refLair('traverses')] },
  { target: 'Guidance', weight: 1, text: 'On the back of an eagle {hero} flew above {wilds} and dropped at last beside {lair}, {lairEpithet}.', binds: [refHero(), refWilds(), refLair('traverses')] },
  { target: 'Guidance', weight: 1, text: 'Over three-nine lands and through {wilds} {hero} walked, until the way ended at {lair}, {lairEpithet}.', binds: [refHero(), refWilds(), refLair('traverses')] },

  // H , Struggle: direct combat (never references the agent).
  { target: 'Struggle', weight: 1, text: '{hero} and {villain}, {villainEpithet}, closed in battle, and the dust they raised hid sun and moon for three days.', binds: [refHero(), refVillain()] },
  { target: 'Struggle', weight: 1, text: 'Sleeves rolled to the elbow, {hero} fell upon {villain}, {villainEpithet}, and they wrestled till the black earth groaned beneath them.', binds: [refHero(), refVillain()] },
  { target: 'Struggle', weight: 1, text: '{villain}, {villainEpithet}, breathed fire across the field, but {hero} stood the flame and gave blow for blow.', binds: [refHero(), refVillain()] },
  { target: 'Struggle', weight: 1, text: 'They struck the first time and the earth shook; they struck the second and the waters churned; at the third {hero} and {villain}, {villainEpithet}, were locked beyond parting.', binds: [refHero(), refVillain()] },
  { target: 'Struggle', weight: 1, text: "{hero} sank to the knees in the trampled ground, yet rose again to grapple {villain}, {villainEpithet}, neither yielding a hand's breadth.", binds: [refHero(), refVillain()] },
  { target: 'Struggle', weight: 1, text: 'From dawn to dusk {hero} traded strokes with {villain}, {villainEpithet}, and the ravens gathered to wait the end.', binds: [refHero(), refVillain()] },

  // J , Victory (with the agent , the gun fires).
  { target: 'Victory', weight: 1, text: 'At the last {hero} loosed {agent}, {agentEpithet}, and {villain}, {villainEpithet}, was thrown down and beaten.', binds: [refHero(), refVillain(), refAgent()] },
  { target: 'Victory', weight: 1, text: '{hero} raised {agent}, {agentEpithet}, and at its touch the strength ran out of {villain}, {villainEpithet}, like water from a cracked jug.', binds: [refHero(), refVillain(), refAgent()] },
  { target: 'Victory', weight: 1, text: 'With {agent}, {agentEpithet}, {hero} struck once and clean, and {villain}, {villainEpithet}, fell where it stood and rose no more.', binds: [refHero(), refVillain(), refAgent()] },
  { target: 'Victory', weight: 1, text: "{agent}, {agentEpithet}, blazed up in the hero's grip, and {villain}, {villainEpithet}, shrank back and was undone before {hero}.", binds: [refHero(), refVillain(), refAgent()] },

  // J , Victory (bare-handed , gated on "no Agent present").
  { target: 'Victory', weight: 1, text: '{hero} caught {villain}, {villainEpithet}, by the heel, swung it thrice about, and dashed it against the bare earth.', binds: [refHero(), refVillain()], forbid: [{ label: 'Agent' }] },
  { target: 'Victory', weight: 1, text: "By a cunning word {hero} turned the villain's own strength against it, and {villain}, {villainEpithet}, was tricked into its own ruin.", binds: [refHero(), refVillain()], forbid: [{ label: 'Agent' }] },
  { target: 'Victory', weight: 1, text: '{hero} found the one cold spot beneath the scales, set a thumb upon it, and {villain}, {villainEpithet}, gave a great cry and was no more.', binds: [refHero(), refVillain()], forbid: [{ label: 'Agent' }] },

  // M , Difficult task (the no-agent development).
  { target: 'DifficultTask', weight: 1, text: '{setter}, {setterEpithet}, poured wheat and chaff together in a heap and bade {hero} sort every grain before the cock should crow.', binds: [refHero(), bindMinor('setter', { roles: ['elder', 'guardian'] })] },
  { target: 'DifficultTask', weight: 1, text: 'Twelve maidens stood alike as drops of rain, and {hero} was charged to name the true bride among them or lose the head.', binds: [refHero()] },
  { target: 'DifficultTask', weight: 1, text: '{setter}, {setterEpithet}, led out a horse no man had backed, and told {hero} to ride it from dawn to dark and never be thrown.', binds: [refHero(), bindMinor('setter', { roles: ['guardian', 'elder'] })] },
  { target: 'DifficultTask', weight: 1, text: 'Between {x}, {xEpithet}, and its sister well the waters warred, and {hero} was bidden fetch a brimming cup from each before nightfall.', binds: [refHero(), bindPlace('x', ['well', 'river'])] },
  { target: 'DifficultTask', weight: 1, text: 'In a single night {hero} was set to raise a bridge of glass across {x}, {xEpithet}, or answer for it at dawn.', binds: [refHero(), bindPlace('x', ['river', 'bridge'])] },
  { target: 'DifficultTask', weight: 1, text: 'An impossible task was laid on {hero}: to plough the wild field, sow it, reap it, and grind the bread, all between one sunset and the next.', binds: [refHero()] },

  // N , Solution.
  { target: 'Solution', weight: 1, text: '{hero} laid {agent}, {agentEpithet}, upon the heap, and by morning every grain lay sorted to its own kind.', binds: [refHero(), refAgent()] },
  { target: 'Solution', weight: 1, text: 'By the help of ants and birds beholden to a past kindness, {hero} saw the labour finished while the kingdom slept.', binds: [refHero()] },
  { target: 'Solution', weight: 1, text: 'At the third pass {agent}, {agentEpithet}, showed {hero} the one maiden whose hand did not tremble, and so the true bride was named.', binds: [refHero(), refAgent()] },
  { target: 'Solution', weight: 1, text: "{hero} marked beforehand a thread tied at the true bride's heel, and named her without a falter when the twelve stood forth.", binds: [refHero()] },
  { target: 'Solution', weight: 1, text: "{hero} whispered the secret word into the wild horse's ear, and it grew gentle as a lamb and bore the hero till dark.", binds: [refHero()] },
  { target: 'Solution', weight: 1, text: 'Where strength would have failed, {hero} thought it through by cunning, and the impossible task lay done by first light.', binds: [refHero()] },
]

// --- RESOLUTION: K · ↓ · Pr/Rs · L · Q · Ex · U · W ---
// (Authored in the voice of a court poet.)
const RESOLUTION_SCENARIOS: Scenario[] = [
  // K , Liquidation of the lack: the taken one is recovered.
  { target: 'Liquidation', weight: 2, text: "{hero}, {heroEpithet}, struck the lock from the door, and {princess}, {hero}'s {princessRelation} long lost, stepped free into the light.", binds: [refHero(), refPrincess()] },
  { target: 'Liquidation', text: '{hero} bore {princess}, {princessEpithet}, up out of the deep and into the living world once more.', binds: [refHero(), refPrincess()] },
  { target: 'Liquidation', text: 'The chains fell from {princess}, {princessEpithet}, and {hero} took her hand to lead her home.', binds: [refHero(), refPrincess()] },
  { target: 'Liquidation', text: '{hero}, {heroEpithet}, broke the spell that bound {princess}, and what was stolen was a stolen thing no longer.', binds: [refHero(), refPrincess()] },
  { target: 'Liquidation', weight: 1, text: '{princess}, {princessEpithet}, woke as if from a long winter, free at last of the dark.', binds: [refPrincess()] },

  // ↓ , Return: the road back from the lair, through the wilds.
  { target: 'Return', weight: 2, text: 'From {lair} {hero}, {heroEpithet}, turned homeward, and the long road folded short as he came again into {wilds}, {wildsEpithet}.', binds: [refHero(), refLair(), refWilds('traverses')] },
  { target: 'Return', text: '{hero} bore {princess} out of {lair} and set their faces toward home, back across {wilds}, {wildsEpithet}.', binds: [refHero(), refPrincess(), refLair(), refWilds('traverses')] },
  { target: 'Return', text: 'Leaving {lair} behind, {hero}, {heroEpithet}, struck out through {wilds} the way he had come.', binds: [refHero(), refLair(), refWilds('traverses')] },

  // Pr/Rs , Pursuit & rescue: chased across the wilds toward the gateway home.
  { target: 'Pursuit & rescue', weight: 2, text: '{villain}, {villainEpithet}, sent its riders howling after {hero} across {wilds}, but he reached {gateway} and flung down a comb that sprang into a forest behind him.', binds: [refHero(), refVillain(), refWilds(), refGateway('traverses')] },
  { target: 'Pursuit & rescue', text: 'The host of {villain} came on like a storm through {wilds}, yet {hero}, {heroEpithet}, crossed {gateway} and burned the bridge behind him.', binds: [refHero(), refVillain(), refWilds(), refGateway('traverses')] },
  { target: 'Pursuit & rescue', text: 'Swift as wind {villain} pursued across {wilds}, but at {gateway} {hero}, {heroEpithet}, turned himself into a falcon and slipped clean away.', binds: [refHero(), refVillain(), refWilds(), refGateway('traverses')] },

  // L , False claim: the impostor claims the deed. Generic variants forbid a
  // rival with a social-web bondType, so the relationship-gated ones win when a
  // tie to the hero was drawn (the rival is his brother / boyhood rival).
  { target: 'FalseClaim', weight: 2, text: '{rival}, {rivalEpithet}, rode up first to the tsar and swore that the great deed had been done by his own hand.', binds: [refRival()], forbid: [{ label: 'FalseHero', where: [{ key: 'bondType', op: 'exists' }] }] },
  { target: 'FalseClaim', text: '{rival} laid the proofs upon the table and claimed the victory, and the court believed him.', binds: [refRival()], forbid: [{ label: 'FalseHero', where: [{ key: 'bondType', op: 'exists' }] }] },
  { target: 'FalseClaim', text: '{rival}, {rivalEpithet}, had the true one cast aside and stepped forward to take the reward as his due.', binds: [refRival()], forbid: [{ label: 'FalseHero', where: [{ key: 'bondType', op: 'exists' }] }] },
  // Relationship-gated: the betrayal stings because the rival is close to the hero.
  { target: 'FalseClaim', weight: 2, text: "{rival}, {hero}'s own elder brother, rode up first and swore before the tsar that the deed had been his.", binds: [refRivalBond('sibling'), refHero()] },
  { target: 'FalseClaim', weight: 2, text: "{rival}, {hero}'s rival since boyhood, thrust himself forward to claim the glory for his own.", binds: [refRivalBond('rival'), refHero()] },

  // Q , Recognition: the true hero is known (never references the rival).
  { target: 'Recognition', weight: 2, text: '{princess}, {princessEpithet}, knew {hero} at once by the ring she had given him, and named him before them all.', binds: [refHero(), refPrincess()] },
  { target: 'Recognition', text: 'When {hero} bared the old scar at his side, {princess} cried out that here, here was the one who had saved her.', binds: [refHero(), refPrincess()] },
  { target: 'Recognition', text: '{hero}, {heroEpithet}, answered the riddle no other could, and {princess} knew him for the true one.', binds: [refHero(), refPrincess()] },
  { target: 'Recognition', text: 'From the crowd {princess}, {princessEpithet}, picked out {hero} and set the half-token to her own to show them matched.', binds: [refHero(), refPrincess()] },
  { target: 'Recognition', weight: 1, text: '{hero} drew forth the token he had kept, and {princess} wept to see it whole again.', binds: [refHero(), refPrincess()] },

  // Ex , Exposure: the impostor is unmasked.
  { target: 'Exposure', weight: 2, text: '{rival}, {rivalEpithet}, could not answer the simplest question of the deed, and his whole boast crumbled before the court.', binds: [refRival()] },
  { target: 'Exposure', text: 'Then {hero} produced the proof, and {rival}, {rivalEpithet}, stood unmasked as a liar before the tsar.', binds: [refRival(), refHero()] },
  { target: 'Exposure', text: '{rival} went grey to the lips when the true token appeared, and his stolen glory fell away like ash.', binds: [refRival()] },
  { target: 'Exposure', text: 'Loud as he had crowed, {rival}, {rivalEpithet}, had not a word left when {hero} stepped from the crowd.', binds: [refRival(), refHero()] },
  { target: 'Exposure', weight: 1, text: 'The lie of {rival}, {rivalEpithet}, was laid bare, and he was driven from the hall in shame.', binds: [refRival()] },

  // U , Punishment of the villain.
  { target: 'Punishment', weight: 2, text: '{villain}, {villainEpithet}, was given the end it had earned, and troubled the land no more.', binds: [refVillain()] },
  { target: 'Punishment', text: '{hero} cast {villain}, {villainEpithet}, into the fire, and not even ash was left to remember it by.', binds: [refHero(), refVillain()] },
  { target: 'Punishment', text: "The death of {villain} was found at last in the needle's point, and so it perished as it had lived, by cunning.", binds: [refVillain()] },
  { target: 'Punishment', text: '{villain}, {villainEpithet}, was bound to wild horses and scattered to the four winds.', binds: [refVillain()] },
  { target: 'Punishment', weight: 1, text: '{villain}, {villainEpithet}, met its end, and the people rang the bells for a week and a day.', binds: [refVillain()] },

  // W , Wedding / reward: the close, back home where the journey began.
  { target: 'Wedding', weight: 2, text: '{hero} brought {princess}, {princessEpithet}, home to {home}, {homeEpithet}, and there they were wed, and the old tsar gave over the half of the kingdom.', binds: [refHero(), refPrincess(), refHome('traverses')] },
  { target: 'Wedding', weight: 1, text: '{hero} wed {princess}, {princessEpithet}, and the old tsar gave over to him the half of the kingdom and the crown to follow.', binds: [refHero(), refPrincess()] },
  { target: 'Wedding', text: 'In {x}, {xEpithet}, {hero} and {princess} were married, and the feasting lasted three days and three nights.', binds: [refHero(), refPrincess(), bindPlace('x', ['hall'])] },
  { target: 'Wedding', text: '{hero}, {heroEpithet}, took {princess} to wife, and from that day they ruled in peace and plenty.', binds: [refHero(), refPrincess()] },
  { target: 'Wedding', text: 'They crowned {hero} and {princess} together in {x}, {xEpithet}, and the whole land made merry.', binds: [refHero(), refPrincess(), bindPlace('x', ['hall'])] },
  { target: 'Wedding', weight: 1, text: 'So {hero} married {princess}, {princessEpithet}, and there was a feast for all the world , and I was there too, and drank the mead and beer, and it ran down my beard but never passed my lips.', binds: [refHero(), refPrincess()] },
]

const ALL_SCENARIOS: Scenario[] = [
  ...PREP_SCENARIOS,
  ...COMPLICATION_SCENARIOS,
  ...TRIALS_SCENARIOS,
  ...RESOLUTION_SCENARIOS,
]

// ===========================================================================
// THE GRAMMAR.
// ===========================================================================
export function proppMorphologyV2 (): Grammar {
  const start = emptyGraph()

  // The hero anchor (named generically; casting will draw a concrete identity).
  start.nodes.push(makeNode('Hero', { name: 'the youth' }, 140, 330))

  // Seed the cast pool. Keep references to the CastChar nodes so we can wire the
  // SOCIAL WEB of `rel` edges among them below.
  const byName = new Map<string, ReturnType<typeof makeNode>>()
  CAST_CHARS.forEach((c, i) => {
    const n = makeNode('CastChar', { ...c }, 740, 24 + i * 22)
    byName.set(c.name, n)
    start.nodes.push(n)
  })
  CAST_ITEMS.forEach((it, i) => start.nodes.push(makeNode('CastItem', { ...it }, 960, 40 + i * 30)))
  CAST_PLACES.forEach((pl, i) => start.nodes.push(makeNode('CastPlace', { ...pl }, 1100, 30 + i * 26)))

  // THE SOCIAL WEB. Directed `rel` edges among cast members, typed by a `kind`
  // prop. Prefer-related casting reads these so the tale's principals hang
  // together (this hero's own betrothed; the villain who covets her; the rival
  // who is the hero's brother), and the web stays visible beside the tale.
  const rel = (src: string, dst: string, kind: string) => {
    const a = byName.get(src); const b = byName.get(dst)
    if (a && b) start.edges.push(makeEdge(a.id, b.id, 'rel', true, { kind }))
  }
  // hero → (beloved | kin) → the taken one
  rel('Ivan', 'Yelena', 'beloved'); rel('Ivan', 'Vasilisa', 'kin')
  rel('Alyosha', 'Marya Morevna', 'beloved'); rel('Alyosha', 'Yelena', 'beloved')
  rel('Dobrynya', 'Vasilisa', 'kin'); rel('Dobrynya', 'Marya Morevna', 'beloved')
  // villain → (covets | claims | kin) → the taken one
  rel('Koschei the Deathless', 'Yelena', 'covets'); rel('Koschei the Deathless', 'Marya Morevna', 'covets')
  rel('the Sea-Tsar', 'Marya Morevna', 'claims')
  rel('Baba Yaga', 'Vasilisa', 'kin')
  rel('the Dragon Gorynych', 'Yelena', 'covets'); rel('the Dragon Gorynych', 'Vasilisa', 'covets')
  // rival → (sibling | rival) → the hero
  rel("the boyar's son", 'Ivan', 'sibling'); rel('the cook', 'Alyosha', 'sibling')
  rel('the water-carrier', 'Dobrynya', 'rival'); rel("the boyar's son", 'Dobrynya', 'rival'); rel('the cook', 'Ivan', 'rival')

  // ----- PASS 1: structural rules (v1), pass-1 generic helpers --------------
  function fn (from: string, to: string, label: string, sym: string, color: string, group: string, desc: string, weight = 1): Rule {
    return rule({
      name: `${sym} · ${label}`,
      description: desc,
      color,
      group,
      weight,
      lhs: {
        nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: from }] })],
        edges: [pe('e', 's', 't', { label: 'next', directed: true })],
      },
      rhs: {
        nodes: [
          rn('s', '*', { mapFrom: 's' }),
          rn('f', label, { setProps: { sym: lit(sym), n: counter() } }),
          rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(to) } }),
        ],
        edges: [re('th', 's', 'f', { label: 'then', directed: true }), re('nx', 'f', 't', { label: 'next', directed: true })],
      },
    })
  }
  function skip (from: string, to: string, name: string, group: string, desc: string, weight = 1): Rule {
    return rule({
      name,
      description: desc,
      color: '#adb5bd',
      group,
      weight,
      lhs: { nodes: [pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: from }] })], edges: [] },
      rhs: { nodes: [rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(to) } })], edges: [] },
    })
  }

  const PREP = 'Preparation'; const COMP = 'Complication'; const DONO = 'Donor'; const CLIM = 'Climax'; const RESO = 'Resolution'; const FRAME = 'Frame'

  const initial = rule({
    name: 'α · Initial situation',
    description: 'The tale opens and the Tale frontier is born. Fires once; downstream order is gated on its phase.',
    color: '#868e96',
    group: FRAME,
    priority: 100,
    maxApplications: 1,
    lhs: { nodes: [pn('h', 'Hero')], edges: [] },
    rhs: {
      nodes: [
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('f', 'InitialSituation', { setProps: { sym: lit('α'), n: counter() } }),
        rn('t', 'Tale', { setProps: { phase: lit(P.absent) } }),
      ],
      edges: [re('st', 'h', 'f', { label: 'stars', directed: true }), re('nx', 'f', 't', { label: 'next', directed: true })],
    },
  })

  const absent = fn(P.absent, P.interdict, 'Absentation', 'β', '#f59f00', PREP, 'A family member absents themselves. Optional.', 2)
  const noAbsent = skip(P.absent, P.interdict, '(skip absentation)', PREP, 'Omit β.', 1)
  const interdict = fn(P.interdict, P.recon, 'Interdiction', 'γ/δ', '#f59f00', PREP, 'An interdiction is given and then violated (γ + δ). Optional.', 2)
  const noInterdict = skip(P.interdict, P.recon, '(skip interdiction)', PREP, 'Omit the γ/δ pair.', 1)

  const recon = rule({
    name: 'ε · Reconnaissance , the villain appears',
    description: 'The villain enters and scouts the hero/family. Early antagonist introduction; persists to act, be defeated, and be punished.',
    color: '#fa5252',
    group: PREP,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recon }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Reconnaissance', { setProps: { sym: lit('ε'), n: counter() } }),
        rn('v', 'Villain', { setProps: { name: lit('the enemy'), defeated: lit(false) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.villainy) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('ac', 'f', 'v', { label: 'scouts', directed: true }),
      ],
    },
  })

  const villainy = rule({
    name: 'A · Villainy , the villain strikes',
    description: 'The villain causes harm and a Lack is created. The same Villain from ε, now acting. The Lack pays off at K.',
    color: '#e03131',
    group: COMP,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.villainy }] }),
        pn('v', 'Villain'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Villainy', { setProps: { sym: lit('A'), n: counter() } }),
        rn('v', 'Villain', { mapFrom: 'v' }),
        rn('l', 'Lack', { setProps: { of: lit('a loved one'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.mediation) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('cm', 'v', 'f', { label: 'commits', directed: true }),
        re('ca', 'f', 'l', { label: 'causes', directed: true }),
      ],
    },
  })

  const mediation = fn(P.mediation, P.counter, 'Mediation', 'B', '#e8590c', COMP, 'The misfortune is made known; the hero is dispatched (B). Obligatory.')
  const counteraction = fn(P.counter, P.departure, 'Counteraction', 'C', '#e8590c', COMP, 'The hero agrees to counteraction (C). Obligatory.')
  const departureAlone = fn(P.departure, P.donor, 'Departure', '↑', '#4dabf7', COMP, 'The hero leaves home alone (↑). Obligatory.', 2)
  const departureRival = rule({
    name: '↑ · Departure , a rival sets out too',
    description: 'The hero leaves AND a rival/false hero sets out , seeded early, exposed late at the recognition section. Optional.',
    color: '#d6336c',
    group: COMP,
    weight: 1,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.departure }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Departure', { setProps: { sym: lit('↑'), n: counter() } }),
        rn('fh', 'FalseHero', { setProps: { name: lit('a rival'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.donor) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('rv', 'f', 'fh', { label: 'joined by', directed: true }),
      ],
    },
  })

  const receive = rule({
    name: 'F · Receipt of a magical agent',
    description: "The donor sequence (D-E-F folded): the hero acquires and wields a magical agent , Chekhov's gun. If it fires, the climax must use it.",
    color: '#2f9e44',
    group: DONO,
    weight: 3,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.donor }] }),
        pn('h', 'Hero'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'ReceiveAgent', { setProps: { sym: lit('F'), n: counter() } }),
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('a', 'Agent', { setProps: { name: lit('a charm'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.guidance) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('wd', 'h', 'a', { label: 'wields', directed: true }),
      ],
    },
  })
  const noReceive = skip(P.donor, P.guidance, '(skip donor)', DONO, 'Omit the donor sequence , no agent, so the climax falls to a bare struggle or a difficult task.', 1)

  const guidance = fn(P.guidance, P.climax, 'Guidance', 'G', '#4dabf7', COMP, 'The hero is led to the object of the search (G). Obligatory.')

  const struggleAgent = rule({
    name: 'H/J · Struggle & victory (with the agent)',
    description: 'Combat (H) + victory (J) BY USING THE AGENT. The only climax that matches when an Agent exists, so a received agent is guaranteed to be used.',
    color: '#7048e8',
    group: CLIM,
    weight: 1,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.climax }] }),
        pn('h', 'Hero'),
        pn('a', 'Agent'),
        pn('v', 'Villain'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true }), pe('w', 'h', 'a', { label: 'wields', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('hf', 'Struggle', { setProps: { sym: lit('H'), n: counter() } }),
        rn('jf', 'Victory', { setProps: { sym: lit('J'), n: counter() } }),
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('a', 'Agent', { mapFrom: 'a' }),
        rn('v', 'Villain', { mapFrom: 'v', setProps: { defeated: lit(true) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.liquidation) } }),
      ],
      edges: [
        re('th', 's', 'hf', { label: 'then', directed: true }),
        re('th2', 'hf', 'jf', { label: 'then', directed: true }),
        re('nx', 'jf', 't', { label: 'next', directed: true }),
        re('us', 'hf', 'a', { label: 'uses', directed: true }),
        re('df', 'jf', 'v', { label: 'defeats', directed: true }),
      ],
    },
  })

  const struggleBare = rule({
    name: 'H/J · Struggle & victory (bare-handed)',
    description: "Combat & victory without an agent. NAC'd on Agent, so it only fires when the donor was skipped.",
    color: '#9775fa',
    group: CLIM,
    weight: 2,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.climax }] }),
        pn('v', 'Villain'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('hf', 'Struggle', { setProps: { sym: lit('H'), n: counter() } }),
        rn('jf', 'Victory', { setProps: { sym: lit('J'), n: counter() } }),
        rn('v', 'Villain', { mapFrom: 'v', setProps: { defeated: lit(true) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.liquidation) } }),
      ],
      edges: [
        re('th', 's', 'hf', { label: 'then', directed: true }),
        re('th2', 'hf', 'jf', { label: 'then', directed: true }),
        re('nx', 'jf', 't', { label: 'next', directed: true }),
        re('df', 'jf', 'v', { label: 'defeats', directed: true }),
      ],
    },
    nac: [{ nodes: [pn('x', 'Agent')], edges: [] }],
  })

  const task = rule({
    name: 'M/N · Difficult task & solution',
    description: "Propp's other development: a difficult task (M) is set and solved (N) instead of combat. NAC'd on Agent. The villain survives to U.",
    color: '#9775fa',
    group: CLIM,
    weight: 1,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.climax }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('mf', 'DifficultTask', { setProps: { sym: lit('M'), n: counter() } }),
        rn('nf', 'Solution', { setProps: { sym: lit('N'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.liquidation) } }),
      ],
      edges: [
        re('th', 's', 'mf', { label: 'then', directed: true }),
        re('th2', 'mf', 'nf', { label: 'then', directed: true }),
        re('nx', 'nf', 't', { label: 'next', directed: true }),
      ],
    },
    nac: [{ nodes: [pn('x', 'Agent')], edges: [] }],
  })

  // K , Liquidation. v2 change: KEEP the Lack (mark `liquidated`) so pass 2 can
  // still name the rescued victim.
  const liquidation = rule({
    name: 'K · Liquidation of the lack',
    description: 'The lack is liquidated , the taken one recovered. v2: the Lack is MARKED `liquidated` rather than deleted, so the rescued victim survives to be named in pass 2.',
    color: '#0ca678',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.liquidation }] }),
        pn('l', 'Lack', { predicates: [{ key: 'liquidated', op: 'absent' }] }),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Liquidation', { setProps: { sym: lit('K'), n: counter() } }),
        rn('l', 'Lack', { mapFrom: 'l', setProps: { liquidated: lit(true) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.rtn) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('rc', 'f', 'l', { label: 'recovers', directed: true }),
      ],
    },
  })

  const rtn = fn(P.rtn, P.pursuit, 'Return', '↓', '#4dabf7', RESO, 'The hero returns (↓). Obligatory.')
  const pursuit = fn(P.pursuit, P.recognition, 'Pursuit & rescue', 'Pr/Rs', '#f59f00', RESO, 'The hero is pursued and rescued (Pr/Rs). Optional.', 2)
  const noPursuit = skip(P.pursuit, P.recognition, '(skip pursuit)', RESO, 'Omit pursuit/rescue.', 1)

  // L/Q/Ex , expose the rival. v2: KEEP the FalseHero (mark `exposed`).
  const expose = rule({
    name: 'L/Q/Ex · Expose the false hero',
    description: 'A false hero claims the deed (L); the true hero is recognised (Q); the impostor is exposed (Ex). v2: the FalseHero is MARKED `exposed`, not deleted.',
    color: '#d6336c',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recognition }] }),
        pn('fh', 'FalseHero', { predicates: [{ key: 'exposed', op: 'absent' }] }),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('lf', 'FalseClaim', { setProps: { sym: lit('L'), n: counter() } }),
        rn('qf', 'Recognition', { setProps: { sym: lit('Q'), n: counter() } }),
        rn('xf', 'Exposure', { setProps: { sym: lit('Ex'), n: counter() } }),
        rn('fh', 'FalseHero', { mapFrom: 'fh', setProps: { exposed: lit(true) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.punishment) } }),
      ],
      edges: [
        re('th', 's', 'lf', { label: 'then', directed: true }),
        re('th2', 'lf', 'qf', { label: 'then', directed: true }),
        re('th3', 'qf', 'xf', { label: 'then', directed: true }),
        re('nx', 'xf', 't', { label: 'next', directed: true }),
        re('ex', 'xf', 'fh', { label: 'exposes', directed: true }),
      ],
    },
  })
  const recognition = rule({
    name: 'Q · Recognition (no rival)',
    description: "The true hero is recognised (Q). NAC'd on un-exposed FalseHero, so a seeded rival must be exposed first. Optional.",
    color: '#f59f00',
    group: RESO,
    weight: 2,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recognition }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Recognition', { setProps: { sym: lit('Q'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.punishment) } }),
      ],
      edges: [re('th', 's', 'f', { label: 'then', directed: true }), re('nx', 'f', 't', { label: 'next', directed: true })],
    },
    nac: [{ nodes: [pn('x', 'FalseHero', { predicates: [{ key: 'exposed', op: 'absent' }] })], edges: [] }],
  })
  const noRecognition = rule({
    name: '(skip recognition)',
    description: "Omit recognition. NAC'd on un-exposed FalseHero , a seeded rival can't be silently skipped.",
    color: '#adb5bd',
    group: RESO,
    weight: 1,
    lhs: { nodes: [pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recognition }] })], edges: [] },
    rhs: { nodes: [rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.punishment) } })], edges: [] },
    nac: [{ nodes: [pn('x', 'FalseHero', { predicates: [{ key: 'exposed', op: 'absent' }] })], edges: [] }],
  })

  // U , Punishment. v2: KEEP the Villain (mark `punished`).
  const punishment = rule({
    name: 'U · Punishment of the villain',
    description: 'The villain is punished. v2: the Villain is MARKED `punished` rather than deleted, so it can still be named in pass 2.',
    color: '#e03131',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.punishment }] }),
        pn('v', 'Villain', { predicates: [{ key: 'punished', op: 'absent' }] }),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Punishment', { setProps: { sym: lit('U'), n: counter() } }),
        rn('v', 'Villain', { mapFrom: 'v', setProps: { punished: lit(true) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.wedding) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('pn', 'f', 'v', { label: 'punishes', directed: true }),
      ],
    },
  })

  const wedding = rule({
    name: 'W · Wedding / reward',
    description: 'The hero weds and/or ascends (W). The canonical close; flips the frontier to `done`.',
    color: '#0ca678',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.wedding }] }),
        pn('h', 'Hero'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Wedding', { setProps: { sym: lit('W'), n: counter() } }),
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.done) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('wd', 'h', 'f', { label: 'weds', directed: true }),
      ],
    },
  })

  // Ω , tear down the frontier so pass 1 halts and pass 2 (NAC'd on Tale) opens.
  const close = rule({
    name: 'Ω · Structure complete → unlock concretization',
    description: "The frontier reached `done`: remove the Tale node. Pass 1 is over; with no Tale present, every pass-2 casting & fleshing rule (each NAC'd on Tale) becomes eligible.",
    color: '#868e96',
    group: FRAME,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.done }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: { nodes: [rn('s', '*', { mapFrom: 's' })], edges: [] },
    embedding: [emb('t', 'remove')],
  })

  // ----- PASS 2a: CASTING , locations (the route) + principals (social web) -
  // All NAC'd on Tale, so they only fire after pass 1. Gated on `cast`/`role`
  // predicates so each fires the right number of times and the run terminates.
  const TALE_NAC = { nodes: [pn('_tale', 'Tale')], edges: [] }

  // -- Locations: cast the four journey stops from the place pool, then pave the
  //    road home → gateway → wilds → lair so the itinerary is visible. ---------
  function castStop (role: string, kinds: string[]): Rule {
    return rule({
      name: `⌖ Cast the ${role}`,
      description: `Draw the journey's ${role} stop from the place pool (a ${kinds.join('/')}), creating a Location and consuming the place. NAC'd on an existing ${role} stop, so it fires once.`,
      color: '#2b8a3e',
      group: 'Locations',
      lhs: { nodes: [pn('c', 'CastPlace', { predicates: [{ key: 'kind', op: 'in', value: kinds }] })], edges: [] },
      rhs: {
        nodes: [rn('loc', 'Location', { setProps: { role: lit(role), name: copyProp('c', 'name'), epithet: copyProp('c', 'epithet'), cast: lit(true) } })],
        edges: [],
      },
      nac: [TALE_NAC, { nodes: [pn('x', 'Location', { predicates: [{ key: 'role', op: 'eq', value: role }] })], edges: [] }],
      embedding: [emb('c', 'remove')],
    })
  }
  const castHome = castStop('home', ['village'])
  const castGateway = castStop('gateway', ['gate', 'bridge'])
  const castWilds = castStop('wilds', ['forest', 'river', 'field'])
  const castLair = castStop('lair', ['cave', 'mountain'])

  const paveRoad = rule({
    name: '⌖ Pave the road (home → gateway → wilds → lair)',
    description: 'Once all four stops are cast, join them with directed `road` edges and place the Hero `at` home , the visible itinerary the travel beats traverse. Fires once (home is marked `paved`).',
    color: '#37b24d',
    group: 'Locations',
    lhs: {
      nodes: [
        pn('h', 'Hero'),
        pn('a', 'Location', { predicates: [{ key: 'role', op: 'eq', value: 'home' }, { key: 'paved', op: 'absent' }] }),
        pn('b', 'Location', { predicates: [{ key: 'role', op: 'eq', value: 'gateway' }] }),
        pn('c', 'Location', { predicates: [{ key: 'role', op: 'eq', value: 'wilds' }] }),
        pn('d', 'Location', { predicates: [{ key: 'role', op: 'eq', value: 'lair' }] }),
      ],
      edges: [],
    },
    rhs: {
      nodes: [
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('a', 'Location', { mapFrom: 'a', setProps: { paved: lit(true) } }),
        rn('b', 'Location', { mapFrom: 'b' }),
        rn('c', 'Location', { mapFrom: 'c' }),
        rn('d', 'Location', { mapFrom: 'd' }),
      ],
      edges: [
        re('at', 'h', 'a', { label: 'at', directed: true }),
        re('r1', 'a', 'b', { label: 'road', directed: true }),
        re('r2', 'b', 'c', { label: 'road', directed: true }),
        re('r3', 'c', 'd', { label: 'road', directed: true }),
      ],
    },
    nac: [TALE_NAC],
  })

  // -- The hero: any protagonist. Kept (not consumed) and linked by `plays`, so
  //    its social-web ties stay reachable when casting the rest. ---------------
  const castHero = rule({
    name: '⊙ Cast the hero',
    description: 'Draw a protagonist from the pool, name the Hero, and keep the CastChar linked by `plays` so its social-web ties drive who else is cast.',
    color: '#1971c2',
    group: 'Casting',
    lhs: {
      nodes: [
        pn('e', 'Hero', { predicates: [{ key: 'cast', op: 'absent' }] }),
        pn('c', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: 'hero' }, { key: 'cast', op: 'absent' }] }),
      ],
      edges: [],
    },
    rhs: {
      nodes: [
        rn('e', 'Hero', { mapFrom: 'e', setProps: { name: copyProp('c', 'name'), epithet: copyProp('c', 'epithet'), cast: lit(true) } }),
        rn('c', 'CastChar', { mapFrom: 'c', setProps: { cast: lit(true) } }),
      ],
      edges: [re('pl', 'e', 'c', { label: 'plays', directed: true })],
    },
    nac: [TALE_NAC],
  })

  // -- The taken one: prefer a victim tied to the hero in the web (his betrothed
  //    or kin); fall back to any victim if none is linked. ---------------------
  const castVictimRel = rule({
    name: "⊙ Cast the taken one (the hero's own)",
    description: 'Prefer a victim the hero is tied to in the social web (beloved/kin); name the Lack, link Lack→victim by `plays`, and draw a visible `kin` edge Hero→Lack.',
    color: '#ae3ec9',
    group: 'Casting',
    lhs: {
      nodes: [
        pn('e', 'Lack', { predicates: [{ key: 'cast', op: 'absent' }] }),
        pn('h', 'Hero', { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
        pn('hc', 'CastChar'),
        pn('c', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: 'victim' }, { key: 'cast', op: 'absent' }] }),
      ],
      edges: [
        pe('hp', 'h', 'hc', { label: 'plays', directed: true }),
        pe('rel', 'hc', 'c', { label: 'rel', directed: true, predicates: [{ key: 'kind', op: 'in', value: ['beloved', 'kin'] }] }),
      ],
    },
    rhs: {
      nodes: [
        rn('e', 'Lack', { mapFrom: 'e', setProps: { of: copyProp('c', 'name'), victimEpithet: copyProp('c', 'epithet'), victimRelation: copyProp('c', 'relation'), cast: lit(true) } }),
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('hc', 'CastChar', { mapFrom: 'hc' }),
        rn('c', 'CastChar', { mapFrom: 'c', setProps: { cast: lit(true) } }),
      ],
      edges: [
        re('hp', 'h', 'hc', { label: 'plays', directed: true, mapFrom: 'hp' }),
        re('rel', 'hc', 'c', { label: 'rel', directed: true, mapFrom: 'rel' }),
        re('lp', 'e', 'c', { label: 'plays', directed: true }),
        re('hk', 'h', 'e', { label: 'kin', directed: true }),
      ],
    },
    nac: [TALE_NAC],
  })
  const castVictimAny = rule({
    name: '⊙ Cast the taken one (any)',
    description: "Fallback: no social-web tie to the hero , cast any victim. NAC'd on the existence of a related victim, so the related rule is always preferred.",
    color: '#ae3ec9',
    group: 'Casting',
    lhs: {
      nodes: [
        pn('e', 'Lack', { predicates: [{ key: 'cast', op: 'absent' }] }),
        pn('h', 'Hero', { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
        pn('c', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: 'victim' }, { key: 'cast', op: 'absent' }] }),
      ],
      edges: [],
    },
    rhs: {
      nodes: [
        rn('e', 'Lack', { mapFrom: 'e', setProps: { of: copyProp('c', 'name'), victimEpithet: copyProp('c', 'epithet'), victimRelation: copyProp('c', 'relation'), cast: lit(true) } }),
        rn('h', 'Hero', { mapFrom: 'h' }),
        rn('c', 'CastChar', { mapFrom: 'c', setProps: { cast: lit(true) } }),
      ],
      edges: [re('lp', 'e', 'c', { label: 'plays', directed: true })],
    },
    nac: [
      TALE_NAC,
      {
        nodes: [
          pn('h2', 'Hero', { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
          pn('hc2', 'CastChar'),
          pn('vc2', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: 'victim' }, { key: 'cast', op: 'absent' }] }),
        ],
        edges: [
          pe('hp2', 'h2', 'hc2', { label: 'plays', directed: true }),
          pe('rel2', 'hc2', 'vc2', { label: 'rel', directed: true, predicates: [{ key: 'kind', op: 'in', value: ['beloved', 'kin'] }] }),
        ],
      },
    ],
  })

  // -- Bond-casting factory: cast a principal who is tied (in the web) to an
  //    already-cast anchor entity, recording the tie as `bondType` (for the
  //    prose) and a visible `kin` edge. Used for the villain (anchored on the
  //    taken one) and the rival (anchored on the hero). ----------------------
  function castBond (name: string, entity: string, role: string, anchor: string, kind: string, color: string): Rule {
    return rule({
      name,
      description: `Prefer a ${role} tied as '${kind}' to the ${anchor === 'Lack' ? 'taken one' : 'hero'}; set bondType='${kind}' (for the prose) and add a kin edge.`,
      color,
      group: 'Casting',
      lhs: {
        nodes: [
          pn('e', entity, { predicates: [{ key: 'cast', op: 'absent' }] }),
          pn('a', anchor, { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
          pn('ac', 'CastChar'),
          pn('c', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: role }, { key: 'cast', op: 'absent' }] }),
        ],
        edges: [
          pe('ap', 'a', 'ac', { label: 'plays', directed: true }),
          pe('rel', 'c', 'ac', { label: 'rel', directed: true, predicates: [{ key: 'kind', op: 'eq', value: kind }] }),
        ],
      },
      rhs: {
        nodes: [
          rn('e', entity, { mapFrom: 'e', setProps: { name: copyProp('c', 'name'), epithet: copyProp('c', 'epithet'), bondType: lit(kind), cast: lit(true) } }),
          rn('a', anchor, { mapFrom: 'a' }),
          rn('ac', 'CastChar', { mapFrom: 'ac' }),
          rn('c', 'CastChar', { mapFrom: 'c', setProps: { cast: lit(true) } }),
        ],
        edges: [
          re('ap', 'a', 'ac', { label: 'plays', directed: true, mapFrom: 'ap' }),
          re('rel', 'c', 'ac', { label: 'rel', directed: true, mapFrom: 'rel' }),
          re('pl', 'e', 'c', { label: 'plays', directed: true }),
          re('kin', 'e', 'a', { label: 'kin', directed: true }),
        ],
      },
      nac: [TALE_NAC],
    })
  }
  // Fallback caster: any member of `role`, only when no web-tied candidate to
  // `anchor` (via any of `kinds`) exists. Keeps `entity` from being cast
  // unrelated while a related option is still available.
  function castAny (name: string, entity: string, role: string, anchor: string, kinds: string[], color: string): Rule {
    return rule({
      name,
      description: `Fallback: cast any ${role}. NAC'd on a web-tied candidate, so the bonded casters are preferred.`,
      color,
      group: 'Casting',
      lhs: {
        nodes: [
          pn('e', entity, { predicates: [{ key: 'cast', op: 'absent' }] }),
          pn('a', anchor, { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
          pn('c', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: role }, { key: 'cast', op: 'absent' }] }),
        ],
        edges: [],
      },
      rhs: {
        nodes: [
          rn('e', entity, { mapFrom: 'e', setProps: { name: copyProp('c', 'name'), epithet: copyProp('c', 'epithet'), cast: lit(true) } }),
          rn('a', anchor, { mapFrom: 'a' }),
          rn('c', 'CastChar', { mapFrom: 'c', setProps: { cast: lit(true) } }),
        ],
        edges: [re('pl', 'e', 'c', { label: 'plays', directed: true })],
      },
      nac: [
        TALE_NAC,
        {
          nodes: [
            pn('a2', anchor, { predicates: [{ key: 'cast', op: 'eq', value: true }] }),
            pn('ac2', 'CastChar'),
            pn('c2', 'CastChar', { predicates: [{ key: 'role', op: 'eq', value: role }, { key: 'cast', op: 'absent' }] }),
          ],
          edges: [
            pe('ap2', 'a2', 'ac2', { label: 'plays', directed: true }),
            pe('rel2', 'c2', 'ac2', { label: 'rel', directed: true, predicates: [{ key: 'kind', op: 'in', value: kinds }] }),
          ],
        },
      ],
    })
  }

  // The villain is anchored on the taken one (so it casts after the victim);
  // the rival on the hero. One bonded caster per relationship kind + a fallback.
  const castVilCovets = castBond('⊙ Cast the villain (covets her)', 'Villain', 'villain', 'Lack', 'covets', '#c92a2a')
  const castVilClaims = castBond('⊙ Cast the villain (claims her by bargain)', 'Villain', 'villain', 'Lack', 'claims', '#c92a2a')
  const castVilKin = castBond('⊙ Cast the villain (her faithless kin)', 'Villain', 'villain', 'Lack', 'kin', '#c92a2a')
  const castVillainAny = castAny('⊙ Cast the villain (any)', 'Villain', 'villain', 'Lack', ['covets', 'claims', 'kin'], '#c92a2a')
  const castRivSibling = castBond("⊙ Cast the rival (the hero's brother)", 'FalseHero', 'rival', 'Hero', 'sibling', '#e64980')
  const castRivRival = castBond('⊙ Cast the rival (a boyhood rival)', 'FalseHero', 'rival', 'Hero', 'rival', '#e64980')
  const castRivalAny = castAny('⊙ Cast the rival (any)', 'FalseHero', 'rival', 'Hero', ['sibling', 'rival'], '#e64980')

  // The magical agent: a magical object, consumed from the item pool.
  const castAgent = rule({
    name: '⊙ Cast the magical agent',
    description: 'Draw a magical object from the item pool and name the Agent (consumed).',
    color: '#2f9e44',
    group: 'Casting',
    lhs: {
      nodes: [
        pn('e', 'Agent', { predicates: [{ key: 'cast', op: 'absent' }] }),
        pn('c', 'CastItem', { predicates: [{ key: 'kind', op: 'in', value: ['talisman', 'weapon', 'relic'] }] }),
      ],
      edges: [],
    },
    rhs: {
      nodes: [rn('e', 'Agent', { mapFrom: 'e', setProps: { name: copyProp('c', 'name'), epithet: copyProp('c', 'epithet'), cast: lit(true) } })],
      edges: [],
    },
    nac: [TALE_NAC],
    embedding: [emb('c', 'remove')],
  })

  // ----- PASS 2b: FLESHING , one rule per scenario variant ------------------
  const fleshRules = ALL_SCENARIOS.map((s, i) => flesh(s, i))

  return grammar(
    "08 · Propp's Morphology , v2 (concrete tale)",
    [
      // pass 1: structure
      initial,
      absent, noAbsent,
      interdict, noInterdict,
      recon,
      villainy, mediation, counteraction,
      departureAlone, departureRival,
      receive, noReceive,
      guidance,
      struggleAgent, struggleBare, task,
      liquidation, rtn,
      pursuit, noPursuit,
      expose, recognition, noRecognition,
      punishment, wedding,
      close,
      // pass 2a: locations (route) + casting (social web)
      castHome, castGateway, castWilds, castLair, paveRoad,
      castHero,
      castVictimRel, castVictimAny,
      castVilCovets, castVilClaims, castVilKin, castVillainAny,
      castRivSibling, castRivRival, castRivalAny,
      castAgent,
      // pass 2b: fleshing
      ...fleshRules,
    ],
    start,
    { strategy: 'random', maxSteps: -1, maxNodes: 400, seed: 7 }
  )
}

// ===========================================================================
// narrateTale , render the finished `then`-chain as concrete prose.
// ===========================================================================
export function fillTemplate (text: string, props: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = props[k]
    return v === undefined || v === null ? `{${k}}` : String(v)
  })
}

export const capitalizeFirst = (s: string): string => s.replace(/[a-zA-Z]/, (c) => c.toUpperCase())

/** Walk the tale in canonical (`n`) order and return the fleshed prose. Each
 *  step is capitalized so templates may safely begin with a {slot}. */
export function narrateTale (g: Graph): string {
  const steps = g.nodes
    .filter((n) => typeof n.props?.n === 'number' && typeof n.props?.text === 'string')
    .sort((a, b) => (a.props.n as number) - (b.props.n as number))
  return steps.map((n) => capitalizeFirst(fillTemplate(n.props.text as string, n.props))).join(' ')
}

// ===========================================================================
// Well-formedness for v2: the v1 structural guarantees PLUS concretization
// completeness (every function fleshed, every entity cast, no leftover {slot}).
// ===========================================================================
export interface TaleViolation {
  kind: string;
  detail: string;
}

export function validateTale (g: Graph): { ok: boolean; violations: TaleViolation[] } {
  const v: TaleViolation[] = []
  const byLabel = (l: string) => g.nodes.filter((n) => n.label === l)

  if (byLabel('Tale').length) v.push({ kind: 'unfinished', detail: 'Tale frontier still present , structure did not reach `done`.' })

  // Resolution markers (v2 keeps the entities but must mark them resolved).
  for (const n of byLabel('Lack')) if (n.props.liquidated !== true) v.push({ kind: 'unliquidated-lack', detail: `Lack of '${n.props.of ?? '?'}' was never liquidated (missing K).` })
  for (const n of byLabel('Villain')) if (n.props.punished !== true) v.push({ kind: 'unpunished-villain', detail: `Villain '${n.props.name ?? '?'}' was never punished (missing U).` })
  for (const n of byLabel('FalseHero')) if (n.props.exposed !== true) v.push({ kind: 'unexposed-false-hero', detail: `FalseHero '${n.props.name ?? '?'}' was never exposed (missing Ex).` })

  // Chekhov's gun: a received Agent must be used at the climax.
  const used = new Set<string>()
  for (const e of g.edges) if (e.label === 'uses') { used.add(e.source); used.add(e.target) }
  for (const n of byLabel('Agent')) if (!used.has(n.id)) v.push({ kind: 'unfired-gun', detail: `Agent '${n.props.name ?? '?'}' was received but never used.` })

  // Obligatory spine.
  const syms = new Set(g.nodes.map((n) => n.props?.sym).filter(Boolean))
  for (const s of ['α', 'A', 'K', 'W'] as const) if (!syms.has(s)) v.push({ kind: 'missing-core', detail: `Obligatory function ${s} is absent.` })

  // v2 concretization completeness.
  for (const e of ['Hero', 'Villain'] as const) for (const n of byLabel(e)) if (n.props.cast !== true) v.push({ kind: 'uncast-entity', detail: `${e} was never cast (no concrete identity).` })

  // v2.1 itinerary completeness: all four journey stops cast, and the road paved.
  for (const role of ['home', 'gateway', 'wilds', 'lair']) {
    if (!g.nodes.some((n) => n.label === 'Location' && n.props.role === role && n.props.cast === true)) { v.push({ kind: 'incomplete-itinerary', detail: `Journey stop '${role}' was never cast.` }) }
  }
  if (byLabel('Location').length && !g.edges.some((e) => e.label === 'road')) { v.push({ kind: 'unpaved-route', detail: 'Journey stops exist but the road between them was never paved.' }) }
  for (const n of g.nodes) {
    if (typeof n.props?.sym === 'string' && typeof n.props.text !== 'string') v.push({ kind: 'unfleshed-step', detail: `Function ${n.props.sym} (${n.label}) has no concrete prose.` })
    if (typeof n.props?.text === 'string' && /\{[a-zA-Z]\w*\}/.test(n.props.text as string)) {
      const rendered = fillTemplate(n.props.text as string, n.props)
      if (/\{[a-zA-Z]\w*\}/.test(rendered)) v.push({ kind: 'unfilled-slot', detail: `Step ${n.props.sym ?? n.label} has an unfilled slot: "${rendered}".` })
    }
  }

  return { ok: v.length === 0, violations: v }
}
