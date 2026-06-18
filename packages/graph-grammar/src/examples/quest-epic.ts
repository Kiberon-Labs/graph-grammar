import type { Grammar, Rule, PropExpr } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, randInt, counter, copyProp, incProp } from '../builders.ts'
import { makeNode, makeEdge, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// 12. ★★ Epic Multi-Quest World , the stress test. A single large world graph
//     (3 regions: 17 Locations on a road network, 20 characters, 15 items) over
//     which all SEVEN major quest archetypes generate their quest-path subgraphs
//     SIMULTANEOUSLY from one Giver:
//        treasure (obtain a Relic)      · vengeance (slay the Villain who wronged you)
//        rescue (free a Captive)        · knowledge (seek a Sage, then a Secret)
//        return-home (Odyssey journey)  · monster (hunt & slay a Monster)
//        love (court & wed the Beloved)
//     The world + the quest designs/obstacles/failures were produced by a fan-out
//     of 17 sub-agents (one per region + design→critique per quest type).
//
//     HOW PARALLEL QUESTS COEXIST: every rule predicates on the frontier's `kind`,
//     so seven Quest frontiers grow independently over the shared world without
//     interfering. The seven goal labels are all distinct (Relic/Villain/Captive/
//     Secret/Monster/Beloved + a home Location), so no two quests ever contend for
//     a fact. Each quest tracks its OWN exploration via a per-kind `seen_<kind>`
//     flag on Locations and its OWN position via a `Quest --at--> Location` edge.
//     The proven mechanics are reused: prefer-unexplored travel, frontier `next`
//     splice, fact consumption with emb-remove, deterministic low-priority FAIL
//     terminals, and a `legs` budget that guarantees termination (a quest that
//     runs out of legs dissolves into a "lost" terminal).
//
//     Run on the `priority` strategy. Step through to watch each quest line
//     assemble across the map; quests finish with a DONE terminal or a FAIL.
// ---------------------------------------------------------------------------
export function questEpic (): Grammar {
  const start = emptyGraph()

  // ---- World data (merged from the 3 region-builder agents) -----------------
  const HOMES = new Set(['Willowmere Cottage', 'Hliderhall'])
  // [name, region, x, y]
  const locDefs: Array<[string, string, number, number]> = [
    ['Willowmere Cottage', 'Verdant Reach', 110, 110],
    ["Greenwarden's Crossing", 'Verdant Reach', 250, 190],
    ['Sylvanthel', 'Verdant Reach', 140, 300],
    ['The Drowned Ruin of Aelmoor', 'Verdant Reach', 300, 360],
    ['The Hidden Grove of Eithne', 'Verdant Reach', 60, 400],
    ['Mossfen Hollow', 'Verdant Reach', 330, 250],
    ['Cinder Camp', 'Ashen Wastes', 430, 470],
    ['Glasswind Pass', 'Ashen Wastes', 540, 410],
    ['Obsidian Fortress', 'Ashen Wastes', 590, 520],
    ['Ashmere Spring', 'Ashen Wastes', 410, 580],
    ['Bone Field', 'Ashen Wastes', 500, 620],
    ['Smoking Caldera', 'Ashen Wastes', 600, 620],
    ['Hliderhall', 'Frostspire Marches', 720, 130],
    ['Cairnvigil Monastery', 'Frostspire Marches', 830, 200],
    ['Snowmere Croft', 'Frostspire Marches', 690, 270],
    ['Glasstongue Pass', 'Frostspire Marches', 840, 330],
    ['Rimewail Crypt', 'Frostspire Marches', 790, 410],
  ]
  const locId: Record<string, string> = {}
  const locPos: Record<string, [number, number]> = {}
  for (const [name, region, x, y] of locDefs) {
    const props: Record<string, string | boolean> = { name, region }
    if (HOMES.has(name)) props.home = true
    const n = makeNode('Location', props, x, y)
    start.nodes.push(n)
    locId[name] = n.id
    locPos[name] = [x, y]
  }

  // Road network (undirected) , intra-region + 3 inter-region bridges so the
  // whole world is one connected graph (needed for cross-region journeys).
  const roads: Array<[string, string]> = [
    ['Willowmere Cottage', "Greenwarden's Crossing"],
    ["Greenwarden's Crossing", 'Sylvanthel'],
    ["Greenwarden's Crossing", 'Mossfen Hollow'],
    ['Mossfen Hollow', 'The Drowned Ruin of Aelmoor'],
    ['Sylvanthel', 'The Hidden Grove of Eithne'],
    ['Sylvanthel', 'The Drowned Ruin of Aelmoor'],
    ['Cinder Camp', 'Glasswind Pass'],
    ['Glasswind Pass', 'Obsidian Fortress'],
    ['Cinder Camp', 'Ashmere Spring'],
    ['Ashmere Spring', 'Bone Field'],
    ['Bone Field', 'Smoking Caldera'],
    ['Smoking Caldera', 'Obsidian Fortress'],
    ['Hliderhall', 'Cairnvigil Monastery'],
    ['Hliderhall', 'Snowmere Croft'],
    ['Cairnvigil Monastery', 'Glasstongue Pass'],
    ['Snowmere Croft', 'Glasstongue Pass'],
    ['Glasstongue Pass', 'Rimewail Crypt'],
    ['Snowmere Croft', 'Rimewail Crypt'],
    // inter-region bridges
    ["Greenwarden's Crossing", 'Cinder Camp'],
    ['Ashmere Spring', 'Snowmere Croft'],
    ['Sylvanthel', 'Hliderhall'],
  ]
  for (const [a, b] of roads) start.edges.push(makeEdge(locId[a], locId[b], 'road', false))
  // a topology bypass (used thematically; available to extend with stealth routes)
  start.edges.push(makeEdge(locId['Smoking Caldera'], locId['Obsidian Fortress'], 'side_exit', true))

  // Characters: [name, label, location]. label ∈ NPC|Villain|Monster|Sage|Captive|Beloved
  const chars: Array<[string, string, string]> = [
    ['Maren Quickwillow', 'Beloved', 'Willowmere Cottage'],
    ['Warden Aldric Thorne', 'NPC', "Greenwarden's Crossing"],
    ['Faelyn Silverbough', 'Sage', 'Sylvanthel'],
    ['Lirael Ashveil', 'Captive', 'The Drowned Ruin of Aelmoor'],
    ['The Pale Mere-Thing', 'Monster', 'The Drowned Ruin of Aelmoor'],
    ['Morgath the Hollow King', 'Villain', 'The Drowned Ruin of Aelmoor'],
    ['Warlord Karro Vane', 'Villain', 'Obsidian Fortress'],
    ['Cindermaw', 'Monster', 'Smoking Caldera'],
    ['Old Tessa', 'NPC', 'Cinder Camp'],
    ['Mother Ysolde', 'Sage', 'Ashmere Spring'],
    ['Lieutenant Hesk', 'Captive', 'Obsidian Fortress'],
    ['Senna Vane', 'Beloved', 'Cinder Camp'],
    ['Sister Yrsa Coldquill', 'Sage', 'Cairnvigil Monastery'],
    ['Jarl Halvard Stonebrow', 'NPC', 'Hliderhall'],
    ['Brand Icehew', 'NPC', 'Snowmere Croft'],
    ['Eyvind the Lost', 'Captive', 'Rimewail Crypt'],
    ['Naglfrost the Wailing Wyrm', 'Monster', 'Glasstongue Pass'],
  ]
  // Items: [name, label, location]. label ∈ Item|Relic|Secret
  const items: Array<[string, string, string]> = [
    ['The Vernal Heart', 'Relic', 'The Hidden Grove of Eithne'],
    ['The Drowning of Aelmoor', 'Secret', 'Sylvanthel'],
    ['Emberheart Relic', 'Relic', 'Smoking Caldera'],
    ['The Caldera Cipher', 'Secret', 'Ashmere Spring'],
    ['The Rime Codex', 'Secret', 'Cairnvigil Monastery'],
    ['Hearthsteel Lantern', 'Relic', 'Hliderhall'],
    ['Whisperleaf Cloak', 'Item', 'Sylvanthel'],
    ['Obsidian Cleaver', 'Item', 'Bone Field'],
    ['Fur-lined Crampons', 'Item', 'Snowmere Croft'],
  ]
  let satellite = 0
  const place = (loc: string): [number, number] => {
    const [x, y] = locPos[loc] ?? [400, 320]
    const a = (satellite++ * 2.3) % (Math.PI * 2)
    return [x + Math.cos(a) * 46, y + Math.sin(a) * 46]
  }
  for (const [name, label, loc] of chars) {
    const [x, y] = place(loc)
    const n = makeNode(label, { name }, x, y)
    start.nodes.push(n)
    start.edges.push(makeEdge(locId[loc], n.id, 'dwells', true))
  }
  for (const [name, label, loc] of items) {
    const [x, y] = place(loc)
    const n = makeNode(label, { name }, x, y)
    start.nodes.push(n)
    start.edges.push(makeEdge(locId[loc], n.id, 'holds', true))
  }
  // The quest-giver at the central hub; every quest kind is dispatched from here.
  const giver = makeNode('Giver', { name: 'Loremaster Vael' }, 250, 150)
  start.nodes.push(giver)
  start.edges.push(makeEdge(locId["Greenwarden's Crossing"], giver.id, 'dwells', true))

  // ---- Rule helpers (all kind-gated; every Step carries a `kind` prop) -------
  const LEGS = 60
  const COL = {
    accept: '#f59f00',
    travel: '#4dabf7',
    known: '#748ffc',
    act: '#fa5252',
    beat: '#7048e8',
    obst: '#fab005',
    done: '#2f9e44',
    fail: '#e03131',
  }
  const sp = (kind: string, extra: Record<string, PropExpr> = {}): Record<string, PropExpr> => ({ kind: lit(kind), n: counter(), ...extra })
  const kindPred = (kind: string, phase: string) => [{ key: 'kind', op: 'eq' as const, value: kind }, { key: 'phase', op: 'eq' as const, value: phase }]

  // Quest selection: exactly ONE quest is chosen at random and it precludes the
  // others. The Giver rolls once (maxApplications 1) to open a single frontier in
  // a "choosing" phase carrying roll = randInt(0..6); then exactly one `assign`
  // rule (gated on roll == its index) sets the kind & start phase. Because every
  // quest rule is gated on `kind`, and only one frontier of one kind ever exists,
  // the other six archetypes never begin.
  const KCOUNT = 7
  const mkRoll = (): Rule =>
    rule({
      name: '✦ Choose a quest (roll the dice)',
      color: COL.accept,
      priority: 100,
      maxApplications: 1,
      lhs: { nodes: [pn('loc', 'Location'), pn('g', 'Giver')], edges: [pe('d', 'loc', 'g', { label: 'dwells', directed: true })] },
      rhs: {
        nodes: [
          rn('loc', 'Location', { mapFrom: 'loc' }),
          rn('g', 'Giver', { mapFrom: 'g' }),
          rn('s', 'accept', { setProps: { n: counter() } }),
          rn('q', 'Quest', { setProps: { phase: lit('choosing'), roll: randInt(0, KCOUNT - 1), legs: lit(LEGS) } }),
        ],
        edges: [
          re('d', 'loc', 'g', { label: 'dwells', directed: true, mapFrom: 'd' }),
          re('gv', 'g', 's', { label: 'gives', directed: true }),
          re('nx', 's', 'q', { label: 'next', directed: true }),
          re('at', 'q', 'loc', { label: 'at', directed: true }),
        ],
      },
    })
  // assign: the single rule whose index matches the roll claims the frontier for
  // its kind. Only one matches; the rest are dead, so only this quest generates.
  const mkAssign = (kind: string, idx: number, startPhase: string): Rule =>
    rule({
      name: `✦ Begin: ${kind} (roll ${idx})`,
      color: COL.accept,
      priority: 99,
      maxApplications: 1,
      lhs: { nodes: [pn('q', 'Quest', { predicates: [{ key: 'phase', op: 'eq', value: 'choosing' }, { key: 'roll', op: 'eq', value: idx }] })], edges: [] },
      rhs: { nodes: [rn('q', 'Quest', { mapFrom: 'q', setProps: { kind: lit(kind), phase: lit(startPhase) } })], edges: [] },
    })

  // travel: append a step, move the `at` edge to a road-neighbour, mark it seen.
  // Two variants , prefer UNEXPLORED (higher), fall back to a KNOWN neighbour.
  const mkTravel = (kind: string, phase: string): Rule[] => {
    const seen = `seen_${kind}`
    // Travelling is ONE shared behaviour across every quest type, so every travel
    // step carries the same label ("travel"); the destination lives in `to`, and
    // `dir` records whether the leg heads out toward the goal or back home (so
    // leg-specific rules such as failures can still target a homebound leg).
    const dir = phase === 'homebound' ? 'home' : 'out'
    const variant = (suffix: string, seenPred: { key: string; op: 'absent' | 'exists' }, pri: number, color: string): Rule =>
      rule({
        name: `${kind} · travel ${suffix}`,
        color,
        priority: pri,
        lhs: {
          nodes: [
            pn('s', '*', { wildcard: true }),
            pn('q', 'Quest', { predicates: [...kindPred(kind, phase), { key: 'legs', op: 'gt', value: 0 }] }),
            pn('a', 'Location'),
            pn('b', 'Location', { predicates: [seenPred] }),
          ],
          edges: [
            pe('e', 's', 'q', { label: 'next', directed: true }),
            pe('at', 'q', 'a', { label: 'at', directed: true }),
            pe('rd', 'a', 'b', { label: 'road', anyDirection: true }),
          ],
        },
        rhs: {
          nodes: [
            rn('s', '*', { mapFrom: 's' }),
            rn('a', 'Location', { mapFrom: 'a' }),
            rn('b', 'Location', { mapFrom: 'b', setProps: { [seen]: lit(true) } }),
            rn('m', 'travel', { setProps: sp(kind, { to: copyProp('b', 'name'), dir: lit(dir) }) }),
            rn('q', 'Quest', { mapFrom: 'q', setProps: { legs: incProp('q', 'legs', -1) } }),
          ],
          edges: [
            re('rd', 'a', 'b', { label: 'road', mapFrom: 'rd' }),
            re('th', 's', 'm', { label: 'then', directed: true }),
            re('nx', 'm', 'q', { label: 'next', directed: true }),
            re('at', 'q', 'b', { label: 'at', directed: true }),
          ],
        },
      })
    return [
      variant('(unexplored)', { key: seen, op: 'absent' }, 70, COL.travel),
      variant('(known)', { key: seen, op: 'exists' }, 60, COL.known),
    ]
  }

  // meetGoal: when the frontier is AT a Location tied to the goal fact, append the
  // decisive step and (optionally) consume the fact. High priority so it fires on
  // arrival, before travelling onward.
  const mkMeet = (kind: string, fromPhase: string, toPhase: string, goalLabel: string, goalEdge: string, label: string, consume: boolean): Rule => {
    const rhsNodes = [
      rn('s', '*', { mapFrom: 's' }),
      rn('a', 'Location', { mapFrom: 'a' }),
      rn('m', label, { setProps: sp(kind, { target: copyProp('goal', 'name') }) }),
      rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit(toPhase) } }),
    ]
    const rhsEdges = [
      re('th', 's', 'm', { label: 'then', directed: true }),
      re('nx', 'm', 'q', { label: 'next', directed: true }),
      re('at', 'q', 'a', { label: 'at', directed: true, mapFrom: 'at' }),
    ]
    if (!consume) {
      rhsNodes.push(rn('goal', goalLabel, { mapFrom: 'goal' }))
      rhsEdges.push(re('ge', 'a', 'goal', { label: goalEdge, directed: true, mapFrom: 'ge' }))
    }
    return rule({
      name: `${kind} · ${label}`,
      color: COL.act,
      priority: 88,
      maxApplications: 1,
      lhs: {
        nodes: [
          pn('s', '*', { wildcard: true }),
          pn('q', 'Quest', { predicates: kindPred(kind, fromPhase) }),
          pn('a', 'Location'),
          pn('goal', goalLabel),
        ],
        edges: [
          pe('e', 's', 'q', { label: 'next', directed: true }),
          pe('at', 'q', 'a', { label: 'at', directed: true }),
          pe('ge', 'a', 'goal', { label: goalEdge, directed: true }),
        ],
      },
      rhs: { nodes: rhsNodes, edges: rhsEdges },
      embedding: consume ? [emb('goal', 'remove')] : undefined,
    })
  }

  // beat: a pure narrative step that advances the phase (no world interaction).
  const mkBeat = (kind: string, fromPhase: string, toPhase: string, label: string, pri = 86, maxApps = 1): Rule =>
    rule({
      name: `${kind} · ${label}`,
      color: COL.beat,
      priority: pri,
      maxApplications: maxApps,
      lhs: { nodes: [pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: kindPred(kind, fromPhase) })], edges: [pe('e', 's', 'q', { label: 'next', directed: true })] },
      rhs: {
        nodes: [rn('s', '*', { mapFrom: 's' }), rn('m', label, { setProps: sp(kind) }), rn('q', 'Quest', { mapFrom: 'q', setProps: { phase: lit(toPhase) } })],
        edges: [re('th', 's', 'm', { label: 'then', directed: true }), re('nx', 'm', 'q', { label: 'next', directed: true })],
      },
    })

  // obstacle: a one-shot flavour step that stays in the same phase (the journey
  // pauses for a ford / riddle / storm, then travel resumes). Above travel so it
  // happens once before the quest moves on.
  const mkObstacle = (kind: string, phase: string, label: string): Rule => {
    const r = mkBeat(kind, phase, phase, label, 72, 1)
    r.color = COL.obst
    return r
  }

  // finish: arrive at a home Location → report + DONE, dissolve the frontier.
  const mkFinish = (kind: string, fromPhase: string, label: string): Rule =>
    rule({
      name: `${kind} · ${label} (home, DONE)`,
      color: COL.done,
      priority: 90,
      maxApplications: 1,
      lhs: {
        nodes: [pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: kindPred(kind, fromPhase) }), pn('h', 'Location', { predicates: [{ key: 'home', op: 'exists' }] })],
        edges: [pe('e', 's', 'q', { label: 'next', directed: true }), pe('at', 'q', 'h', { label: 'at', directed: true })],
      },
      rhs: {
        nodes: [rn('s', '*', { mapFrom: 's' }), rn('h', 'Location', { mapFrom: 'h' }), rn('m', label, { setProps: sp(kind) }), rn('done', 'DONE', { setProps: { kind: lit(kind) } })],
        edges: [re('th', 's', 'm', { label: 'then', directed: true }), re('end', 'm', 'done', { label: 'then', directed: true })],
      },
      embedding: [emb('q', 'remove')],
    })

  // lost: termination backstop , out of legs → a "lost" FAIL, dissolve frontier.
  const mkLost = (kind: string): Rule =>
    rule({
      name: `${kind} ✗ lost (out of legs)`,
      color: COL.fail,
      priority: 22,
      lhs: { nodes: [pn('s', '*', { wildcard: true }), pn('q', 'Quest', { predicates: [{ key: 'kind', op: 'eq', value: kind }, { key: 'legs', op: 'lte', value: 0 }] })], edges: [pe('e', 's', 'q', { label: 'next', directed: true })] },
      rhs: {
        nodes: [rn('s', '*', { mapFrom: 's' }), rn('f', 'FAIL', { setProps: { kind: lit(kind), reason: lit('lost , the trail went cold') } })],
        edges: [re('th', 's', 'f', { label: 'then', directed: true })],
      },
      embedding: [emb('q', 'remove')],
    })

  // failOff: a deterministic, capped, low-priority FAIL terminal hung off a step
  // of this kind (matched by the kind prop so quests never cross-contaminate).
  const mkFail = (kind: string, stepLabel: string, reason: string, extra: Array<{ key: string; op: 'eq'; value: string }> = []): Rule =>
    rule({
      name: `${kind} ✗ ${reason}`,
      color: COL.fail,
      priority: 25,
      maxApplications: 1,
      lhs: { nodes: [pn('s', stepLabel, { predicates: [{ key: 'kind', op: 'eq', value: kind }, ...extra] })], edges: [] },
      rhs: {
        nodes: [rn('s', stepLabel, { mapFrom: 's' }), rn('f', 'FAIL', { setProps: { kind: lit(kind), reason: lit(reason) } })],
        edges: [re('risk', 's', 'f', { label: 'risk', directed: true })],
      },
    })

  // ---- The seven quest archetypes (shape + obstacles + failures folded in) ---
  // Random single-quest selection: roll once, then assign the rolled kind. The
  // index order here defines which roll maps to which archetype.
  const START: Array<[string, string]> = [
    ['treasure', 'outbound'],
    ['vengeance', 'outbound'],
    ['rescue', 'outbound'],
    ['knowledge', 'seek_sage'],
    ['return', 'outbound'],
    ['monster', 'outbound'],
    ['love', 'court'],
  ]

  const rules: Rule[] = [
    // 0. Choose one quest at random; it precludes the other six.
    mkRoll(),
    ...START.map(([k, p], i) => mkAssign(k, i, p)),

    // 1. TREASURE / MacGuffin: trek out, claim the Relic, bear it home , beware
    //    temptation (corruption) and the river ford.
    ...mkTravel('treasure', 'outbound'),
    mkObstacle('treasure', 'outbound', 'ford'),
    mkMeet('treasure', 'outbound', 'homebound', 'Relic', 'holds', 'claim', true),
    ...mkTravel('treasure', 'homebound'),
    mkFinish('treasure', 'homebound', 'deliver'),
    mkLost('treasure'),
    mkFail('treasure', 'claim', 'claimed by the relic , corrupted'),
    mkFail('treasure', 'ford', 'swept away at the ford'),

    // 2. VENGEANCE: hunt the Villain, expose the guilt, confront , but the
    //    reckoning may ring hollow.
    ...mkTravel('vengeance', 'outbound'),
    mkObstacle('vengeance', 'outbound', 'expose'),
    mkMeet('vengeance', 'outbound', 'homebound', 'Villain', 'dwells', 'confront', true),
    ...mkTravel('vengeance', 'homebound'),
    mkFinish('vengeance', 'homebound', 'serenity'),
    mkLost('vengeance'),
    mkFail('vengeance', 'confront', 'vengeance rang hollow'),

    // 3. RESCUE: reach the Captive, breach the prison, free them, escort home ,
    //    the ward can be lost on the way.
    ...mkTravel('rescue', 'outbound'),
    mkObstacle('rescue', 'outbound', 'breach'),
    mkMeet('rescue', 'outbound', 'homebound', 'Captive', 'dwells', 'free', true),
    ...mkTravel('rescue', 'homebound'),
    mkFinish('rescue', 'homebound', 'deliver'),
    mkLost('rescue'),
    mkFail('rescue', 'travel', 'the ward was lost in the wilds', [{ key: 'dir', op: 'eq', value: 'home' }]),

    // 4. KNOWLEDGE: wander to a Sage, commune, then seek the hidden Secret, and
    //    return home enlightened.
    ...mkTravel('knowledge', 'seek_sage'),
    mkMeet('knowledge', 'seek_sage', 'seek_secret', 'Sage', 'dwells', 'commune', false),
    ...mkTravel('knowledge', 'seek_secret'),
    mkMeet('knowledge', 'seek_secret', 'homebound', 'Secret', 'holds', 'unveil', true),
    ...mkTravel('knowledge', 'homebound'),
    mkFinish('knowledge', 'homebound', 'enlightened'),
    mkLost('knowledge'),
    mkFail('knowledge', 'commune', 'the teaching could not be grasped'),

    // 5. RETURN HOME (Odyssey): one long perilous journey back to any home , the
    //    perils (storm, siren) can strand the wanderer forever.
    ...mkTravel('return', 'outbound'),
    mkObstacle('return', 'outbound', 'weather'),
    mkFinish('return', 'outbound', 'homecoming'),
    mkLost('return'),
    mkFail('return', 'weather', 'lost at sea'),
    mkFail('return', 'travel', 'lured off course by sirens'),

    // 6. OVERCOME MONSTER: hunt the lair, then a two-stage confrontation , wound,
    //    then behead , and carry the trophy home. An unprepared strike can fall.
    ...mkTravel('monster', 'outbound'),
    mkObstacle('monster', 'outbound', 'ford'),
    mkMeet('monster', 'outbound', 'confront', 'Monster', 'dwells', 'ambush', false),
    mkBeat('monster', 'confront', 'slay', 'wound'),
    mkMeet('monster', 'slay', 'homebound', 'Monster', 'dwells', 'behead', true),
    ...mkTravel('monster', 'homebound'),
    mkFinish('monster', 'homebound', 'homecoming'),
    mkLost('monster'),
    mkFail('monster', 'wound', 'the hunter fell, unprepared'),

    // 7. LOVE / UNION: court toward the Beloved, a first impression, then a
    //    proposal and a wedding, then home , a slight can harden into estrangement.
    ...mkTravel('love', 'court'),
    mkObstacle('love', 'court', 'misunderstanding'),
    mkMeet('love', 'court', 'trial', 'Beloved', 'dwells', 'first_impression', false),
    mkMeet('love', 'trial', 'union', 'Beloved', 'dwells', 'propose', true),
    mkBeat('love', 'union', 'homebound', 'wed'),
    ...mkTravel('love', 'homebound'),
    mkFinish('love', 'homebound', 'betrothal'),
    mkLost('love'),
    mkFail('love', 'misunderstanding', 'a slight hardened into estrangement'),
  ]

  return grammar('★★ Epic · Multi-Quest World (stress test)', rules, start, {
    strategy: 'priority',
    maxSteps: -1,
    maxNodes: 600,
    seed: 7,
  })
}
