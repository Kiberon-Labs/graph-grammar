import type { Grammar, Rule, Graph } from '../types.ts'
import { pn, pe, rn, re, emb, rule, grammar, lit, counter } from '../builders.ts'
import { makeNode, emptyGraph } from '../graph.ts'

// ---------------------------------------------------------------------------
// Propp's Morphology of the Folktale (1928) as a graph grammar.
//
// Propp's thesis: every Russian wonder-tale is a single linear sequence drawn
// from a FIXED ALPHABET of 31 "functions" (acts of a character, defined by
// their significance to the plot) that always occur in the SAME CANONICAL
// ORDER. Any given tale uses a SUBSET , functions are skippable , but never
// re-ordered. That is exactly a regular grammar over an ordered alphabet, and
// it drops cleanly onto this engine's frontier-driven idiom (cf. the Quest
// generator, which is itself a small Proppian lack→liquidation machine):
//
//   • A single TALE frontier walks a state machine in its `phase` prop. The
//     phase IS Propp's read-head: it names the next function to consider, and
//     every rule is gated on it, so the canonical ORDER is enforced structurally
//     , no rule for a later function can fire before an earlier one.
//   • Each fired function splices one labelled Step into a growing `then`-chain
//     just behind the frontier (the tale's surface text, in order). The Propp
//     symbol (β, A, K, W …) rides along in the node's `sym` prop.
//   • OPTIONALITY (the heart of the morphology) is a do/skip pair at a phase,
//     both advancing to the next phase. Run under the `random` strategy with
//     weights and each run yields a DIFFERENT well-formed tale from the same
//     grammar , Propp's "one tale, many realisations".
//   • The OBLIGATORY core , A (villainy) · B (mediation) · C (counteraction) ·
//     ↑ (departure) · the struggle/task development · K (liquidation) · ↓
//     (return) · W (wedding) , has no skip rule, so every generated tale has a
//     spine.
//
// THREE SETUP/PAYOFF THREADS make this more than a sequencer:
//
//   THE FALSE HERO (Chekhov's gun #3). An optional rival may set out at the
//   Departure (↑). If one does, the recognition section is forced to expose it
//   (L claims → Q recognition → Ex exposure, consuming it): the plain/skip
//   recognition rules carry a NAC on FalseHero, so a seeded rival can never be
//   silently dropped , introduced early, paid off late.
//
// The two threads that drive every tale:
//
//   THE ANTAGONIST (Chekhov's gun #1). The Villain is introduced EARLY, in the
//   preparatory section (Reconnaissance, ε), long before it acts. It persists,
//   commits the Villainy (A) that creates the Lack, is defeated at the Struggle
//   (H/J), and is finally consumed at Punishment (U). The threat is on the board
//   from act one and every later beat about it was pre-seeded , never a
//   third-act villain dropped from nowhere.
//
//   THE MAGICAL AGENT (Chekhov's gun #2). If the Donor sequence fires, the Hero
//   RECEIVES an Agent (F) , a gun hung on the wall. The grammar then GUARANTEES
//   it goes off: when an Agent exists, the only climax rule that matches is the
//   one that USES it (the bare-handed and difficult-task climaxes carry a NAC
//   forbidding an unused Agent). Receive the agent ⇒ the agent wins the fight.
//   Skip the Donor ⇒ no agent, and the climax falls to a bare struggle or a
//   difficult task instead. That is Chekhov's law as a hard constraint, and the
//   victory is never a deus ex machina: defeating the villain by the agent
//   REQUIRES the agent to have been granted earlier in the same run.
//
// Run on `random`, step through, and watch a tale assemble:
//   α → (β) → (ε:Villain appears) → A:Villainy → B → C → ↑ → (F:Agent) → G →
//   H/J:Struggle(uses Agent, defeats Villain) → K:Liquidation → ↓ → (Pr/Rs) →
//   (Q) → U:Punishment(Villain consumed) → W:Wedding.
// ---------------------------------------------------------------------------

// Phase names = Propp's read-head. Optional phases have a do/skip pair; the
// core phases have only a "do". `done` tears the frontier down and halts.
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

export function proppMorphology (): Grammar {
  const start = emptyGraph()
  // The hero of the tale , the persistent anchor everything hangs off. Stays in
  // the graph for the whole run (receives the agent, wins the fight, weds).
  start.nodes.push(makeNode('Hero', { name: 'Ivan' }, 140, 330))

  // -- A plain function: splice one Step labelled with its Propp symbol behind
  //    the frontier and advance the read-head. This is the workhorse used for
  //    every function whose only effect is to appear in the tale's order.
  function fn (
    from: string,
    to: string,
    label: string,
    sym: string,
    color: string,
    group: string,
    desc: string,
    weight = 1
  ): Rule {
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

  // -- Skip an optional function: advance the read-head, lay nothing. Lower
  //    weight than its paired `fn`, so the function usually appears but
  //    sometimes is omitted , Propp's skippability.
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

  const PREP = 'Preparation'
  const COMP = 'Complication'
  const DONO = 'Donor'
  const CLIM = 'Climax'
  const RESO = 'Resolution'
  const FRAME = 'Frame'

  // === FRAME: α , initial situation. Fires once, builds the frontier. ========
  const initial = rule({
    name: 'α · Initial situation',
    description:
      "The tale opens: the hero is introduced and the Tale frontier is born at the first preparatory phase. Fires exactly once (maxApplications 1); everything downstream is gated on the frontier's phase, so order is enforced from here on.",
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

  // === PREPARATION: optional functions β..θ (here β, γ/δ, and ε). ============
  const absent = fn(P.absent, P.interdict, 'Absentation', 'β', '#f59f00', PREP,
    'A family member absents themselves (the elder leaves). Optional , paired with a skip.', 2)
  const noAbsent = skip(P.absent, P.interdict, '(skip absentation)', PREP, 'Omit β and move straight to the interdiction phase.', 1)

  const interdict = fn(P.interdict, P.recon, 'Interdiction', 'γ/δ', '#f59f00', PREP,
    'An interdiction is addressed to the hero and then violated (γ + δ, folded). The violation is what lets misfortune in. Optional.', 2)
  const noInterdict = skip(P.interdict, P.recon, '(skip interdiction)', PREP, 'Omit the γ/δ pair.', 1)

  // ε , Reconnaissance INTRODUCES THE VILLAIN (antagonist, early). Obligatory in
  // this grammar so the antagonist thread always exists; we take Propp's
  // villainy (A) form of the move rather than the villain-less lack (a) form.
  const recon = rule({
    name: 'ε · Reconnaissance , the villain appears',
    description:
      'The Villain enters and seeks information about the hero/family. This is the EARLY introduction of the antagonist: it appears here, in the preparatory section, and persists , committing the villainy later, being defeated at the climax, and punished at the end. No third-act surprise. Obligatory here so the antagonist thread is always present.',
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
        rn('v', 'Villain', { setProps: { name: lit('Koschei'), defeated: lit(false) } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.villainy) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('ac', 'f', 'v', { label: 'scouts', directed: true }),
      ],
    },
  })

  // === COMPLICATION: the obligatory core that sets the move going. ===========
  // A , Villainy. The early villain now ACTS, creating the Lack that drives the
  // whole tale. Setup (ε) pays off here; this Lack pays off at Liquidation (K).
  const villainy = rule({
    name: 'A · Villainy , the villain strikes',
    description:
      'The villain causes harm: it commits the villainy and a Lack is created (something/someone is stolen or missing). This is the inciting incident and it is the EARLY antagonist developing , the same Villain node from ε, now acting. The Lack it creates is the obligation the tale must later discharge (liquidated at K).',
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
        rn('l', 'Lack', { setProps: { of: lit('the princess'), n: counter() } }),
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

  const mediation = fn(P.mediation, P.counter, 'Mediation', 'B', '#e8590c', COMP,
    'The misfortune is made known and the hero is dispatched or allowed to go (B). Obligatory.')
  const counteraction = fn(P.counter, P.departure, 'Counteraction', 'C', '#e8590c', COMP,
    'The seeker-hero agrees to / decides upon counteraction (C). Obligatory.')
  // ↑ , Departure. Obligatory, but with an optional twist: a RIVAL may set out
  // too. That FalseHero is Chekhov's gun #3 , seeded here, early, and (like the
  // villain) guaranteed to pay off: if one exists, the recognition section MUST
  // expose it (the plain/skip recognition rules are NAC'd on FalseHero).
  const departureAlone = fn(P.departure, P.donor, 'Departure', '↑', '#4dabf7', COMP,
    'The hero leaves home (↑). Obligatory. This variant: the hero sets out alone.', 2)
  const departureRival = rule({
    name: '↑ · Departure , a rival sets out too',
    description:
      "The hero leaves home (↑) AND a rival/false hero sets out as well , seeded early, to claim the hero's deed later. Like the villain, this antagonist is introduced now and pays off at the recognition section (L claims, Ex exposure), where it is consumed. Optional , paired with the solo departure.",
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
        rn('fh', 'FalseHero', { setProps: { name: lit('the water-carrier'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.donor) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('rv', 'f', 'fh', { label: 'joined by', directed: true }),
      ],
    },
  })

  // === DONOR: optional D-E-F. If it fires, the Hero RECEIVES THE AGENT. =======
  // This is Chekhov's gun #2 being hung on the wall.
  const receive = rule({
    name: 'F · Receipt of a magical agent',
    description:
      "Donor sequence (test D, reaction E, receipt F , folded): the hero acquires a magical agent and WIELDS it. This hangs Chekhov's gun on the wall. If this fires, the climax is constrained to USE the agent (see the struggle rules). Optional , paired with a skip.",
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
        rn('a', 'Agent', { setProps: { name: lit('firebird feather'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.guidance) } }),
      ],
      edges: [
        re('th', 's', 'f', { label: 'then', directed: true }),
        re('nx', 'f', 't', { label: 'next', directed: true }),
        re('wd', 'h', 'a', { label: 'wields', directed: true }),
      ],
    },
  })
  const noReceive = skip(P.donor, P.guidance, '(skip donor)', DONO,
    'Omit the donor sequence , the hero gets no magical agent, so the climax falls to a bare struggle or a difficult task.', 1)

  const guidance = fn(P.guidance, P.climax, 'Guidance', 'G', '#4dabf7', COMP,
    'The hero is transferred, delivered, or led to the object of the search (G). Obligatory.')

  // === CLIMAX: three mutually-exclusive developments. ========================
  // 1) Struggle that USES the agent , the only rule that matches when an Agent
  //    exists. The gun fires. Defeats the villain.
  const struggleAgent = rule({
    name: 'H/J · Struggle & victory (with the agent)',
    description:
      "Hero and villain join in combat (H) and the hero wins (J) , BY USING THE AGENT. This is the payoff of Chekhov's gun #2: it requires the Agent the hero received at F. When an Agent exists this is the ONLY climax that matches, so a received agent is guaranteed to be used. Marks the Villain defeated.",
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

  // 2) Bare-handed struggle , only when NO agent exists (NAC). Chekhov's law:
  //    you may not win bare-handed if a gun is on the wall.
  const struggleBare = rule({
    name: 'H/J · Struggle & victory (bare-handed)',
    description:
      'Combat and victory without a magical agent. A NAC forbids this when any Agent exists, so it only happens when the donor sequence was skipped , otherwise the agent must be used. Marks the Villain defeated.',
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

  // 3) Difficult task / solution , the OTHER Proppian development (M-N). Also
  //    NAC'd on the agent so a hung gun always fires via path 1.
  const task = rule({
    name: 'M/N · Difficult task & solution',
    description:
      "The alternative development Propp identifies: a difficult task is proposed (M) and resolved (N) instead of open combat. NAC'd on Agent so it only competes when no agent is in play. The villain survives to be punished at U.",
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

  // === RESOLUTION ============================================================
  // K , Liquidation. The Lack created at A is discharged (consumed). The central
  // obligation is paid: no unfired gun. Obligatory.
  const liquidation = rule({
    name: 'K · Liquidation of the lack',
    description:
      'The initial misfortune or lack is liquidated , the thing taken is recovered. CONSUMES the Lack node created back at the Villainy (A): the central setup pays off here. This is the structural anti-Chekhov check , the obligation opened at A is closed at K.',
    color: '#0ca678',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.liquidation }] }),
        pn('l', 'Lack'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Liquidation', { setProps: { sym: lit('K'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.rtn) } }),
      ],
      edges: [re('th', 's', 'f', { label: 'then', directed: true }), re('nx', 'f', 't', { label: 'next', directed: true })],
    },
    embedding: [emb('l', 'remove')],
  })

  const rtn = fn(P.rtn, P.pursuit, 'Return', '↓', '#4dabf7', RESO,
    'The hero returns (↓). Obligatory.')

  // Pr/Rs , pursuit & rescue, optional.
  const pursuit = fn(P.pursuit, P.recognition, 'Pursuit & rescue', 'Pr/Rs', '#f59f00', RESO,
    'The hero is pursued (Pr) and rescued from pursuit (Rs). Optional , paired with a skip.', 2)
  const noPursuit = skip(P.pursuit, P.recognition, '(skip pursuit)', RESO, 'Omit the pursuit/rescue pair.', 1)

  // Recognition section. Three rules, made mutually exclusive by the FalseHero:
  //  1) A rival exists → it MUST be exposed (L claims → Q recognition → Ex
  //     exposure), and is consumed. Payoff of the rival seeded at departure.
  //  2/3) No rival → plain recognition (Q) or skip, both NAC'd on FalseHero so
  //     they can't pre-empt an exposure. This is the false-hero Chekhov gun.
  const expose = rule({
    name: 'L/Q/Ex · Expose the false hero',
    description:
      "A false hero presses unfounded claims (L) to the hero's deed; the true hero is recognised (Q) and the impostor is exposed (Ex) , and CONSUMED. This closes the rival thread seeded at the departure: introduced early, claims late, exposed and removed. Only fires when a FalseHero exists.",
    color: '#d6336c',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recognition }] }),
        pn('fh', 'FalseHero'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('lf', 'FalseClaim', { setProps: { sym: lit('L'), n: counter() } }),
        rn('qf', 'Recognition', { setProps: { sym: lit('Q'), n: counter() } }),
        rn('xf', 'Exposure', { setProps: { sym: lit('Ex'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.punishment) } }),
      ],
      edges: [
        re('th', 's', 'lf', { label: 'then', directed: true }),
        re('th2', 'lf', 'qf', { label: 'then', directed: true }),
        re('th3', 'qf', 'xf', { label: 'then', directed: true }),
        re('nx', 'xf', 't', { label: 'next', directed: true }),
      ],
    },
    embedding: [emb('fh', 'remove')],
  })
  const recognition = rule({
    name: 'Q · Recognition (no rival)',
    description:
      "The true hero is recognised (Q). NAC'd on FalseHero, so it only fires when no rival was seeded , otherwise the impostor must be exposed first. Optional, paired with a skip.",
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
    nac: [{ nodes: [pn('x', 'FalseHero')], edges: [] }],
  })
  const noRecognition = rule({
    name: '(skip recognition)',
    description: "Omit the recognition sub-sequence. NAC'd on FalseHero , a seeded rival can never be silently skipped.",
    color: '#adb5bd',
    group: RESO,
    weight: 1,
    lhs: { nodes: [pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.recognition }] })], edges: [] },
    rhs: { nodes: [rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.punishment) } })], edges: [] },
    nac: [{ nodes: [pn('x', 'FalseHero')], edges: [] }],
  })

  // U , Punishment. The early villain's thread is finally closed: CONSUME it.
  // Obligatory while a Villain exists.
  const punishment = rule({
    name: 'U · Punishment of the villain',
    description:
      'The villain is punished , and CONSUMED from the graph. This closes the antagonist thread opened all the way back at ε: introduced early, active through the middle, defeated at the climax, removed here. The gun that was hung in act one has fully fired.',
    color: '#e03131',
    group: RESO,
    lhs: {
      nodes: [
        pn('s', '*', { wildcard: true }),
        pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.punishment }] }),
        pn('v', 'Villain'),
      ],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: {
      nodes: [
        rn('s', '*', { mapFrom: 's' }),
        rn('f', 'Punishment', { setProps: { sym: lit('U'), n: counter() } }),
        rn('t', 'Tale', { mapFrom: 't', setProps: { phase: lit(P.wedding) } }),
      ],
      edges: [re('th', 's', 'f', { label: 'then', directed: true }), re('nx', 'f', 't', { label: 'next', directed: true })],
    },
    embedding: [emb('v', 'remove')],
  })

  // W , Wedding / reward. The obligatory finale; flips the frontier to `done`.
  const wedding = rule({
    name: 'W · Wedding / reward',
    description:
      'The hero is married and/or ascends the throne (W) , the canonical close. Links the reward to the hero and sets the frontier to `done`. Obligatory.',
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

  // === FRAME: tear down the frontier so generation halts cleanly. ============
  const close = rule({
    name: 'Ω · Tale complete',
    description:
      'The frontier reached `done`: remove the Tale node (and its dangling `next` pointer). With no frontier, nothing matches and generation halts, leaving a clean `then`-chain , the finished tale in canonical Proppian order.',
    color: '#868e96',
    group: FRAME,
    lhs: {
      nodes: [pn('s', '*', { wildcard: true }), pn('t', 'Tale', { predicates: [{ key: 'phase', op: 'eq', value: P.done }] })],
      edges: [pe('e', 's', 't', { label: 'next', directed: true })],
    },
    rhs: { nodes: [rn('s', '*', { mapFrom: 's' })], edges: [] },
    embedding: [emb('t', 'remove')],
  })

  return grammar(
    "08 · Propp's Morphology of the Folktale",
    [
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
    ],
    start,
    { strategy: 'random', maxSteps: -1, maxNodes: 80, seed: 7 }
  )
}

// ---------------------------------------------------------------------------
// Well-formedness as a mechanical check ("no unfired gun"). Run the grammar to
// a halt, hand the final graph here, and it reports every dangling narrative
// obligation. A clean tale returns `{ ok: true, violations: [] }`. This is the
// setup/payoff economy turned into an assertion: every promise the grammar can
// plant has a corresponding payoff it must reach, and each item below is a
// promise that was left open.
// ---------------------------------------------------------------------------
export interface TaleViolation {
  kind: string;
  detail: string;
}

export function validateTale (g: Graph): { ok: boolean; violations: TaleViolation[] } {
  const v: TaleViolation[] = []
  const byLabel = (l: string) => g.nodes.filter((n) => n.label === l)

  // The generator never finished: a frontier is still on the board.
  if (byLabel('Tale').length) v.push({ kind: 'unfinished', detail: 'Tale frontier still present , generation did not reach `done`.' })

  // A , the central obligation. Every Lack created at the Villainy must be
  // liquidated at K (which consumes it). A surviving Lack is the inciting
  // problem left unresolved.
  for (const n of byLabel('Lack')) v.push({ kind: 'unliquidated-lack', detail: `Lack of '${n.props.of ?? '?'}' was never liquidated (missing K).` })

  // The antagonist threads must close: the villain punished (U) and any false
  // hero exposed (Ex). A surviving one is a loose thread / un-paid setup.
  for (const n of byLabel('Villain')) v.push({ kind: 'unpunished-villain', detail: `Villain '${n.props.name ?? '?'}' was never punished (missing U).` })
  for (const n of byLabel('FalseHero')) v.push({ kind: 'unexposed-false-hero', detail: `FalseHero '${n.props.name ?? '?'}' was never exposed (missing Ex).` })

  // Chekhov's gun: a received Agent must be used. We look for a `uses` edge
  // incident to each Agent; absence means a gun hung on the wall that never
  // fired.
  const used = new Set<string>()
  for (const e of g.edges) if (e.label === 'uses') { used.add(e.source); used.add(e.target) }
  for (const n of byLabel('Agent')) if (!used.has(n.id)) v.push({ kind: 'unfired-gun', detail: `Agent '${n.props.name ?? '?'}' was received but never used at the climax.` })

  // The obligatory spine must be present (α initial, A villainy, K liquidation,
  // W wedding). A missing core function means the tale has no through-line.
  const syms = new Set(g.nodes.map((n) => n.props?.sym).filter(Boolean))
  for (const s of ['α', 'A', 'K', 'W'] as const) if (!syms.has(s)) v.push({ kind: 'missing-core', detail: `Obligatory function ${s} is absent from the tale.` })

  return { ok: v.length === 0, violations: v }
}
