import { useMemo, useState } from 'react';
import { fmtDate, money, titleCase } from '../../lib/format';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  MoneyInput, SectionHeader, Select, StatCard, Textarea, useToast,
} from '../../components/ui';
import { deleteExpense, fetchExpenseReport, recordExpense } from '../../api/finance';
import { useAsync } from '../../lib/hooks';
import type { ExpenseCategory, PaymentMethod } from '../../types';

const CATEGORIES: ExpenseCategory[] = [
  'RENT', 'ELECTRICITY', 'WATER', 'INTERNET', 'TRANSPORTATION', 'MARKETING',
  'PACKAGING', 'SALARIES', 'MAINTENANCE', 'BANK_CHARGES', 'OTHER',
];

/**
 * Operating expenses.
 *
 * Expenses reduce net profit (and therefore the tithe). Two things deliberately
 * cannot be recorded here:
 *   • a supplier payment — that settles stock already counted in cost of goods
 *     sold, and is a balance-sheet movement, not an expense (§24, §60);
 *   • the tithe itself — it is a distribution of profit, so putting it in here
 *     would reduce the very profit it is calculated from (§41).
 */
export default function OwnerExpenses() {
  const { push } = useToast();
  const [from, setFrom] = useState(new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ id: string; number: string } | null>(null);

  const report = useAsync(() => fetchExpenseReport(from, to), [from, to]);

  const rows = useMemo(() => {
    const list = report.data?.items ?? [];
    return category === 'all' ? list : list.filter((e) => e.category === category);
  }, [report.data, category]);

  const total = rows.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-brand-ink">Expenses</h1>
          <p className="text-sm text-brand-muted">
            Rent, utilities, salaries, packaging — anything the shop spends to operate.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Record expense</Button>
      </div>

      <Card className="bg-brand-soft border-brand-line">
        <p className="text-xs text-brand-charcoal leading-relaxed">
          <strong>Not here:</strong> supplier payments (they settle stock already in cost of goods
          sold) and tithe (a distribution of profit). Both are tracked in their own areas so that
          neither distorts net profit.
        </p>
      </Card>

      <Card>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory | 'all')}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      {report.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total in period" value={<>{money(total)} <span className="text-xs font-normal text-brand-muted">Birr</span></>} tone="warn" />
          <StatCard label="Entries" value={rows.length} />
          <StatCard
            label="Largest category"
            value={(report.data.by_category[0] && titleCase(report.data.by_category[0].category)) || '—'}
            sub={report.data.by_category[0] ? money(report.data.by_category[0].total) : undefined}
          />
          <StatCard label="Average entry" value={rows.length ? money(total / rows.length) : money(0)} />
        </div>
      )}

      {report.data && report.data.by_category.length > 0 && (
        <Card>
          <SectionHeader title="By category" subtitle="Where the money went in this period." />
          <div className="space-y-2">
            {report.data.by_category.map((c) => {
              const pct = report.data!.total > 0 ? (Number(c.total) / Number(report.data!.total)) * 100 : 0;
              return (
                <div key={c.category}>
                  <div className="flex items-center justify-between text-sm">
                    <button className="text-brand-charcoal hover:text-brand-deep" onClick={() => setCategory(c.category)}>
                      {titleCase(c.category)}
                    </button>
                    <span className="num text-brand-ink">{money(c.total)} <span className="text-xs text-brand-muted">· {c.entries}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-brand-blush mt-1 overflow-hidden">
                    <div className="h-full bg-brand-rose" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {report.loading ? <LoadingBlock rows={6} /> :
       report.error ? <ErrorState message={report.error} onRetry={report.reload} /> :
       rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No expenses in this period"
            description="Record rent, utilities and wages here so the P&L reflects the real cost of running the shop."
            action={<Button onClick={() => setAddOpen(true)}>Record expense</Button>}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Category</th>
                  <th className="text-right">Amount</th>
                  <th>Paid by</th>
                  <th>Recorded by</th>
                  <th>Description</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <p className="num text-sm text-brand-ink">{e.expense_number}</p>
                      <p className="text-xs text-brand-muted">{fmtDate(e.expense_date)}</p>
                    </td>
                    <td><span className="chip-slate">{titleCase(e.category)}</span></td>
                    <td className="text-right num font-medium">{money(e.amount)}</td>
                    <td className="text-sm text-brand-charcoal">{titleCase(e.payment_method)}</td>
                    <td className="text-sm text-brand-muted">{e.created_by_name || '—'}</td>
                    <td className="text-xs text-brand-muted max-w-[14rem] truncate">{e.description || '—'}</td>
                    <td className="text-right">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setVoidTarget({ id: e.expense_number, number: e.expense_number })}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddExpenseModal open={addOpen} onClose={() => setAddOpen(false)} onDone={() => report.reload()} />

      <VoidExpenseDialog
        target={voidTarget} onClose={() => setVoidTarget(null)}
        onDone={() => { report.reload(); push({ tone: 'success', title: 'Expense removed', body: 'The entry is voided, not erased — the audit log keeps the record.' }); }}
      />
    </div>
  );
}

function AddExpenseModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [category, setCategory] = useState<ExpenseCategory>('RENT');
  const [amount, setAmount] = useState<number | ''>('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (amount === '' || Number(amount) <= 0) {
      push({ tone: 'error', title: 'Enter an amount greater than zero' });
      return;
    }
    setBusy(true);
    try {
      const res = await recordExpense({
        category, amount: Number(amount), paymentMethod: method,
        expenseDate: date, description: description || null,
      });
      push({ tone: 'success', title: `${res.expense_number} recorded`, body: `${money(res.amount)} deducted from this month's profit.` });
      setAmount(''); setDescription('');
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not record the expense', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Record an expense" size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={amount === ''}>Record</Button>
        </>
      }
    >
      <Field label="Category" required>
        <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
        </Select>
      </Field>
      <Field label="Amount" required>
        <MoneyInput value={amount} onValueChange={setAmount} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Paid by">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="TELEBIRR">Telebirr</option>
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Description" hint="What was this for?">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <p className="text-xs text-brand-muted">
        This reduces operating expenses and therefore net profit. It never touches stock or the
        supplier credit book.
      </p>
    </Modal>
  );
}

function VoidExpenseDialog({
  target, onClose, onDone,
}: { target: { id: string; number: string } | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async (reason: string) => {
    setBusy(true);
    try {
      await deleteExpense(target!.id, reason);
      onClose(); onDone();
    } catch (err) {
      push({ tone: 'error', title: 'Could not remove the expense', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={Boolean(target)}
      title="Remove this expense?"
      message={
        <p>
          The expense stops counting towards profit from the moment it is voided. Nothing is deleted:
          the entry and your reason stay in the record.
        </p>
      }
      confirmLabel="Remove expense"
      tone="danger"
      requireReason
      reasonLabel="Why is this being removed?"
      busy={busy}
      onClose={onClose}
      onConfirm={(reason) => void submit(reason)}
    />
  );
}
