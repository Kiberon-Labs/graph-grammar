import { useState } from 'react'
import { X, Plus, ArrowRight, ArrowLeftRight, Minus } from 'lucide-react'
import type {
  Rule,
  PatternNode,
  PatternEdge,
  RhsNode,
  RhsEdge,
  PropExpr,
  PredicateOp,
  EmbeddingRule,
  EmbeddingStrategy,
} from 'graph-grammar'

/** Anything carrying a `setProps` map , an RHS node or an RHS edge. The
 *  property editor below works against this shape, so it serves both. */
type PropTarget = { setProps?: Record<string, PropExpr> }
import { coerce } from '../../util.ts'
import { useApp } from '../../AppContext.tsx'
import { ComboBox } from '../ComboBox.tsx'
import { defaultExpr, hostLabels, isPattern, panelLabel, nodesOf, edgesOf, type PanelId, type Sel } from './model.ts'

interface Props {
  rule: Rule;
  sel: Sel;
  commit: () => void;
  onDelete: () => void;
}

const OPS: PredicateOp[] = ['exists', 'absent', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'regex', 'in']
const EXPR_KINDS: PropExpr['kind'][] = ['literal', 'copy', 'increment', 'randInt', 'randFloat', 'counter']

export function Inspector ({ rule, sel, commit, onDelete }: Props) {
  if (!sel) return <div className='insp-empty'>Select a node, edge, or mapping line to edit its details.</div>
  if (sel.kind === 'node') return <NodeInspector key={sel.id} rule={rule} panel={sel.panel} id={sel.id} commit={commit} onDelete={onDelete} />
  if (sel.kind === 'edge') return <EdgeInspector key={sel.id} rule={rule} panel={sel.panel} id={sel.id} commit={commit} onDelete={onDelete} />
  return <MapInspector key={sel.rhsNodeId} rule={rule} rhsNodeId={sel.rhsNodeId} onDelete={onDelete} />
}

function Field ({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className='field'>
      <span className='field-label'>{label}</span>
      {children}
    </label>
  )
}

function NodeInspector ({ rule, panel, id, commit, onDelete }: { rule: Rule; panel: PanelId; id: string; commit: () => void; onDelete: () => void }) {
  const app = useApp()
  const node = nodesOf(rule, panel).find((n) => n.id === id)
  if (!node) return null
  // Offer labels drawn from the example graph (and "*" for a pattern wildcard) so
  // the node matches/creates real labels; "Custom label…" still allows new ones.
  const labelOptions = isPattern(panel) ? ['*', ...hostLabels(app, rule)] : hostLabels(app, rule)
  return (
    <div className='insp'>
      <h4>{panelLabel(panel)} node</h4>
      <Field label='Label (pick from the graph, or * for wildcard)'>
        <ComboBox
          value={node.label}
          options={labelOptions}
          createLabel='Custom label…'
          placeholder='New label…'
          onChange={(v) => {
            node.label = v
            commit()
          }}
        />
      </Field>
      {isPattern(panel)
        ? (
          <>
            <LhsExtras pn={node as PatternNode} commit={commit} />
            {/* Embedding (what happens to a deleted node's edges) only applies to
                the LHS , NAC nodes are never deleted/mapped, they only forbid. */}
            {panel === 'lhs' && !rule.rhs.nodes.some((n) => n.mapFrom === id) && (
              <EmbeddingEditor rule={rule} lhsNodeId={id} commit={commit} />
            )}
          </>
          )
        : (
          <RhsExtras rule={rule} rn={node as RhsNode} commit={commit} />
          )}
      <button className='danger small' onClick={onDelete}>
        Delete node
      </button>
    </div>
  )
}

function LhsExtras ({ pn, commit }: { pn: PatternNode; commit: () => void }) {
  return (
    <>
      <Field label='Wildcard (match any label)'>
        <input
          type='checkbox'
          checked={!!pn.wildcard}
          onChange={(e) => {
            pn.wildcard = e.target.checked
            commit()
          }}
        />
      </Field>
      <Field label='Exact degree (context)'>
        <input
          type='number'
          value={pn.exactDegree ?? ''}
          placeholder='any'
          onChange={(e) => {
            pn.exactDegree = e.target.value === '' ? null : Number(e.target.value)
            commit()
          }}
        />
      </Field>
      <h5>Property predicates</h5>
      <PredicateEditor pn={pn} commit={commit} />
    </>
  )
}

const EMBED_STRATEGIES: { v: EmbeddingStrategy; label: string }[] = [
  { v: 'remove', label: 'Remove (drop the edges)' },
  { v: 'redirectTo', label: 'Redirect to a node →' },
  { v: 'redirectToAll', label: 'Redirect to all new nodes' },
]

/**
 * Shown when a matched LHS node is *deleted* (has no morphism mapping). It edits
 * the rule's embedding rule for that node , i.e. what happens to the deleted
 * node's edges to the rest of the graph. `redirectTo` a surviving node is how
 * you author node-merging / contraction.
 */
function EmbeddingEditor ({ rule, lhsNodeId, commit }: { rule: Rule; lhsNodeId: string; commit: () => void }) {
  const er = rule.embedding.find((e) => e.lhsNodeId === lhsNodeId)
  const strategy: EmbeddingStrategy = er?.strategy ?? 'remove'

  // ensure an explicit embedding entry exists for this node, then return it
  const ensure = (): EmbeddingRule => {
    let e = rule.embedding.find((x) => x.lhsNodeId === lhsNodeId)
    if (!e) {
      e = { lhsNodeId, strategy: 'remove', targetRhsNodeId: null, edgeLabelFilter: null, newEdgeLabel: null }
      rule.embedding.push(e)
    }
    return e
  }
  const newRhsNodes = rule.rhs.nodes.filter((n) => !n.mapFrom)

  return (
    <>
      <h5>On delete , its edges</h5>
      <div className='insp-note'>
        This LHS node is deleted (no mapping). Choose what happens to its edges to the rest of the graph when the rule fires.
      </div>
      <Field label='Strategy'>
        <select
          value={strategy}
          onChange={(e) => {
            const v = e.target.value as EmbeddingStrategy
            const entry = ensure()
            entry.strategy = v
            if (v === 'redirectTo' && !entry.targetRhsNodeId) entry.targetRhsNodeId = rule.rhs.nodes[0]?.id ?? null
            commit()
          }}
        >
          {EMBED_STRATEGIES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {strategy === 'redirectTo' && (
        <Field label='Redirect target (RHS node)'>
          <select
            value={er?.targetRhsNodeId ?? ''}
            onChange={(e) => {
              ensure().targetRhsNodeId = e.target.value || null
              commit()
            }}
          >
            <option value=''>, pick a node ,</option>
            {rule.rhs.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label || '?'} {n.mapFrom ? '(kept)' : '(new)'}
              </option>
            ))}
          </select>
        </Field>
      )}
      {strategy === 'redirectToAll' && newRhsNodes.length === 0 && (
        <div className='insp-note'>No new RHS nodes to redirect to , add one, or use “redirect to a node”.</div>
      )}
      {strategy !== 'remove' && (
        <>
          <Field label='Only edges labelled (blank = all)'>
            <input
              value={er?.edgeLabelFilter ?? ''}
              placeholder='any label'
              onChange={(e) => {
                ensure().edgeLabelFilter = e.target.value || null
                commit()
              }}
            />
          </Field>
          <Field label='Relabel redirected edges (blank = keep)'>
            <input
              value={er?.newEdgeLabel ?? ''}
              placeholder='keep original'
              onChange={(e) => {
                ensure().newEdgeLabel = e.target.value || null
                commit()
              }}
            />
          </Field>
        </>
      )}
    </>
  )
}

function PredicateEditor ({ pn, commit }: { pn: PatternNode; commit: () => void }) {
  pn.predicates = pn.predicates ?? []
  return (
    <div className='pred-list'>
      {pn.predicates.map((pred, i) => (
        <div className='pred-row' key={i}>
          <input
            className='pred-key'
            value={pred.key}
            placeholder='key'
            onChange={(e) => {
              pred.key = e.target.value
              commit()
            }}
          />
          <select
            value={pred.op}
            onChange={(e) => {
              pred.op = e.target.value as PredicateOp
              commit()
            }}
          >
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            className='pred-val'
            value={pred.value == null ? '' : String(pred.value)}
            placeholder='value'
            disabled={pred.op === 'exists' || pred.op === 'absent'}
            onChange={(e) => {
              pred.value = coerce(e.target.value)
              commit()
            }}
          />
          <button
            className='icon-btn'
            onClick={() => {
              pn.predicates!.splice(i, 1)
              commit()
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        className='small'
        onClick={() => {
          pn.predicates!.push({ key: '', op: 'eq', value: '' })
          commit()
        }}
      >
        <Plus size={13} /> predicate
      </button>
    </div>
  )
}

function RhsExtras ({ rule, rn, commit }: { rule: Rule; rn: RhsNode; commit: () => void }) {
  return (
    <>
      <div className='insp-note'>
        {rn.mapFrom ? 'Preserves LHS node , relabels/keeps it. (drag the ↦ line to remap)' : 'New node , created by this rule.'}
      </div>
      <h5>Set properties (on apply)</h5>
      <SetPropsEditor rule={rule} target={rn} commit={commit} />
    </>
  )
}

function SetPropsEditor ({ rule, target, commit }: { rule: Rule; target: PropTarget; commit: () => void }) {
  target.setProps = target.setProps ?? {}
  const [newKey, setNewKey] = useState('')
  return (
    <div className='pred-list'>
      {Object.entries(target.setProps).map(([key, expr]) => (
        <ExprRow key={key} rule={rule} target={target} propKey={key} expr={expr} commit={commit} />
      ))}
      <div className='pred-row'>
        <input className='pred-key' placeholder='new key' value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        <button
          className='small'
          onClick={() => {
            const k = newKey.trim()
            if (!k) return
            target.setProps![k] = { kind: 'literal', value: '' }
            setNewKey('')
            commit()
          }}
        >
          <Plus size={13} /> set prop
        </button>
      </div>
    </div>
  )
}

function ExprRow ({ rule, target, propKey, expr, commit }: { rule: Rule; target: PropTarget; propKey: string; expr: PropExpr; commit: () => void }) {
  const a = expr as any
  // `copy` / `increment` read from a matched LHS node by id; offer the rule's
  // LHS nodes as a dropdown instead of making the user type the internal id.
  const lhsNodes = rule.lhs.nodes
  return (
    <div className='pred-row'>
      <span className='prop-key'>{propKey}</span>
      <select
        value={expr.kind}
        onChange={(e) => {
          target.setProps![propKey] = defaultExpr(e.target.value as PropExpr['kind'])
          commit()
        }}
      >
        {EXPR_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {expr.kind === 'literal' && (
        <input
          className='pred-val'
          value={String(a.value ?? '')}
          onChange={(e) => {
            a.value = coerce(e.target.value)
            commit()
          }}
        />
      )}
      {(expr.kind === 'copy' || expr.kind === 'increment') && (
        <>
          <select
            className='pred-val'
            title='Copy from this matched LHS node'
            value={lhsNodes.some((n) => n.id === a.from) ? a.from : ''}
            onChange={(e) => { a.from = e.target.value; commit() }}
          >
            <option value=''>{lhsNodes.length ? ', from node ,' : ', no LHS nodes ,'}</option>
            {lhsNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {(n.label || '?') + ' · ' + n.id.slice(-4)}
              </option>
            ))}
          </select>
          <input className='pred-val' placeholder='key' value={a.key ?? ''} onChange={(e) => { a.key = e.target.value; commit() }} />
        </>
      )}
      {expr.kind === 'increment' && (
        <input className='pred-val' type='number' value={a.by ?? 1} onChange={(e) => { a.by = Number(e.target.value); commit() }} />
      )}
      {(expr.kind === 'randInt' || expr.kind === 'randFloat') && (
        <>
          <input className='pred-val' type='number' value={a.min ?? 0} onChange={(e) => { a.min = Number(e.target.value); commit() }} />
          <input className='pred-val' type='number' value={a.max ?? 1} onChange={(e) => { a.max = Number(e.target.value); commit() }} />
        </>
      )}
      <button
        className='icon-btn'
        onClick={() => {
          delete target.setProps![propKey]
          commit()
        }}
      >
        ✕
      </button>
    </div>
  )
}

function EdgeInspector ({ rule, panel, id, commit, onDelete }: { rule: Rule; panel: PanelId; id: string; commit: () => void; onDelete: () => void }) {
  const edge = edgesOf(rule, panel).find((e) => e.id === id)
  if (!edge) return null
  return (
    <div className='insp'>
      <h4>{panelLabel(panel)} edge</h4>
      <Field label='Label (blank = any when matching)'>
        <input
          value={edge.label}
          onChange={(e) => {
            edge.label = e.target.value
            commit()
          }}
        />
      </Field>
      <Field label='Direction'>
        <div className='dir-row'>
          <div className='segmented'>
            <button
              className={'seg' + (edge.directed ? ' active' : '')}
              onClick={() => {
                edge.directed = true
                commit()
              }}
            >
              <ArrowRight size={13} /> Directed
            </button>
            <button
              className={'seg' + (!edge.directed ? ' active' : '')}
              onClick={() => {
                edge.directed = false
                commit()
              }}
            >
              <Minus size={13} /> Undirected
            </button>
          </div>
          <button
            className='ghost small'
            title='Reverse the edge (swap source & target)'
            disabled={!edge.directed}
            onClick={() => {
              const s = edge.source
              edge.source = edge.target
              edge.target = s
              commit()
            }}
          >
            <ArrowLeftRight size={13} /> Flip
          </button>
        </div>
      </Field>
      {isPattern(panel) && (
        <Field label='Ignore direction when matching'>
          <input
            type='checkbox'
            checked={!!(edge as PatternEdge).anyDirection}
            onChange={(e) => {
              (edge as PatternEdge).anyDirection = e.target.checked
              commit()
            }}
          />
        </Field>
      )}
      {panel === 'rhs' && (
        <>
          <h5>Set properties (on apply)</h5>
          <div className='insp-note'>
            {(edge as RhsEdge).mapFrom ? 'Merged onto the matched edge when the rule fires.' : 'Set on the edge this rule creates.'}
          </div>
          <SetPropsEditor rule={rule} target={edge as RhsEdge} commit={commit} />
        </>
      )}
      <button className='danger small' onClick={onDelete}>
        Delete edge
      </button>
    </div>
  )
}

function MapInspector ({ rule, rhsNodeId, onDelete }: { rule: Rule; rhsNodeId: string; onDelete: () => void }) {
  const n = rule.rhs.nodes.find((x) => x.id === rhsNodeId)
  if (!n) return null
  return (
    <div className='insp'>
      <h4>Morphism (LHS ↦ RHS)</h4>
      <div className='insp-note'>
        This RHS node preserves the matched LHS node. Remove the mapping to make it a freshly-created node instead.
      </div>
      <button className='danger small' onClick={onDelete}>
        Remove mapping
      </button>
    </div>
  )
}
