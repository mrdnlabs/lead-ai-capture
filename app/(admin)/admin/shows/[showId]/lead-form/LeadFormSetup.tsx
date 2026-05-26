'use client';

import { useState, useTransition } from 'react';
import { inferAction, saveAction, type FieldDef } from './actions';

interface Props {
  showId: string;
  initialName: string;
  initialCsv: string;
  initialFields: FieldDef[];
}

export function LeadFormSetup({ showId, initialName, initialCsv, initialFields }: Props) {
  const [csv, setCsv] = useState(initialCsv);
  const [formName, setFormName] = useState(initialName || 'Default lead form');
  const [fields, setFields] = useState<FieldDef[]>(initialFields);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingInfer, startInferTransition] = useTransition();
  const [pendingSave, startSaveTransition] = useTransition();

  function runInfer() {
    setError(null);
    setInfo(null);
    startInferTransition(async () => {
      const r = await inferAction(showId, csv);
      if (!r.ok) setError(r.error);
      else {
        setFields(r.fields);
        setInfo(`Inferred ${r.fields.length} fields. Review and edit below, then save.`);
      }
    });
  }

  function runSave() {
    setError(null);
    setInfo(null);
    startSaveTransition(async () => {
      const r = await saveAction(showId, formName, csv, fields);
      if (!r.ok) setError(r.error);
      else setInfo('Saved.');
    });
  }

  function updateField(i: number, patch: Partial<FieldDef>) {
    setFields((cur) => cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((cur) => cur.filter((_, idx) => idx !== i));
  }

  function moveField(i: number, dir: -1 | 1) {
    setFields((cur) => {
      const next = [...cur];
      const j = i + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-medium">1 · Form name</h2>
        <input
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          className="mt-2 block w-full max-w-md rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </section>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="text-sm font-medium">2 · Paste sample iCapture CSV</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Include the header row and ideally one example data row. The AI will infer field types
          and required-ness.
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          placeholder="First Name,Last Name,Email,Company,Title,Interest Level,Products of interest,Best time to call&#10;Jane,Doe,jane@acme.com,Acme,VP Eng,5,Robotics;AI,Morning"
          className="mt-2 block w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={runInfer}
            disabled={pendingInfer || !csv.trim()}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pendingInfer ? 'Inferring with AI…' : 'Infer fields'}
          </button>
          {error ? <span className="text-sm text-red-600">{error}</span> : null}
          {info ? <span className="text-sm text-green-700">{info}</span> : null}
        </div>
      </section>

      {fields.length > 0 ? (
        <section className="rounded-lg border border-neutral-200">
          <header className="flex items-baseline justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2">
            <h2 className="text-sm font-medium">3 · Review fields ({fields.length})</h2>
            <button
              type="button"
              onClick={runSave}
              disabled={pendingSave}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {pendingSave ? 'Saving…' : 'Save lead form'}
            </button>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">CSV header</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Required</th>
                  <th className="px-3 py-2">Options / hint</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-xs text-neutral-400">{i + 1}</td>
                    <td className="px-3 py-2">
                      <input
                        value={f.csvHeader}
                        onChange={(e) => updateField(i, { csvHeader: e.target.value })}
                        className="w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={f.key}
                        onChange={(e) => updateField(i, { key: e.target.value })}
                        className="w-32 rounded border border-neutral-200 px-2 py-1 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={f.type}
                        onChange={(e) =>
                          updateField(i, { type: e.target.value as FieldDef['type'] })
                        }
                        className="rounded border border-neutral-200 px-2 py-1 text-sm"
                      >
                        <option value="text">text</option>
                        <option value="select">select</option>
                        <option value="multiselect">multiselect</option>
                        <option value="boolean">boolean</option>
                        <option value="number">number</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={f.required}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.type === 'select' || f.type === 'multiselect' ? (
                        <input
                          value={(f.options ?? []).join(', ')}
                          placeholder="comma-separated options"
                          onChange={(e) =>
                            updateField(i, {
                              options: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          className="w-full rounded border border-neutral-200 px-2 py-1 text-xs"
                        />
                      ) : (
                        <input
                          value={f.aiExtractionHint ?? ''}
                          placeholder="optional AI hint"
                          onChange={(e) => updateField(i, { aiExtractionHint: e.target.value })}
                          className="w-full rounded border border-neutral-200 px-2 py-1 text-xs"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => moveField(i, -1)}
                          className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(i, 1)}
                          className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(i)}
                          className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-700"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
