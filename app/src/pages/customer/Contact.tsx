import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Field, SectionHeader, Textarea } from '../../components/ui';
import { contactLinks, fetchPublicSettings } from '../../api/portal';
import { useAsync } from '../../lib/hooks';
import type { ContactLinks } from '../../types';

/** Contact page — the shop's public details, plus a free-form message (§5). */
export default function CustomerContact() {
  const { data: settings } = useAsync(() => fetchPublicSettings(), []);
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<ContactLinks | null>(null);
  const [busy, setBusy] = useState(false);

  const s = (settings ?? {}) as Record<string, string | number | boolean | null>;

  const prepare = async () => {
    setBusy(true);
    try {
      const result = await contactLinks(message.trim() || 'Hello LuBella, I have a question.');
      setLinks(result);
      if (result.whatsapp_url) window.open(result.whatsapp_url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <h1 className="text-xl font-semibold text-brand-ink">Contact LuBella</h1>
      <p className="text-sm text-brand-muted mt-1 mb-4">
        Message us about an order, availability or anything else.
      </p>

      <Card className="mb-4">
        <dl className="divide-y divide-brand-line">
          {s.whatsapp_display ? (
            <Row label="WhatsApp" value={String(s.whatsapp_display)} />
          ) : null}
          {s.phone ? <Row label="Phone" value={String(s.phone)} /> : null}
          {s.email ? <Row label="Email" value={String(s.email)} /> : null}
          {s.address ? <Row label="Address" value={String(s.address)} /> : null}
          {s.address_line ? <Row label="Address" value={String(s.address_line)} /> : null}
          {s.support_hours ? <Row label="Opening hours" value={String(s.support_hours)} /> : null}
          {s.telegram_username ? <Row label="Telegram" value={`@${String(s.telegram_username).replace(/^@/, '')}`} /> : null}
          {s.instagram ? <Row label="Instagram" value={String(s.instagram)} /> : null}
          {s.tiktok ? <Row label="TikTok" value={String(s.tiktok)} /> : null}
        </dl>
        {!s.whatsapp_display && !s.phone && (
          <p className="text-sm text-brand-muted">
            The shop has not published its contact details yet.
          </p>
        )}
      </Card>

      <Card>
        <SectionHeader title="Send a message" subtitle="We reply during opening hours." />
        <Field label="Your message">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Hello LuBella, do you have the matte lipstick in a deeper shade?"
          />
        </Field>
        <Button variant="whatsapp" className="w-full" loading={busy} onClick={prepare}>
          Send on WhatsApp
        </Button>
        <p className="text-xs text-brand-muted mt-3">
          The message opens in your own WhatsApp so you can review it before sending.
        </p>

        {links?.message && (
          <div className="mt-4">
            <p className="section-title mb-1.5">Preview</p>
            <pre className="text-xs whitespace-pre-wrap font-sans bg-brand-soft rounded-xl p-3
                            border border-brand-line text-brand-charcoal">{links.message}</pre>
            {links.telegram_url && (
              <a href={links.telegram_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2">
                <Button variant="telegram" size="sm">Send on Telegram</Button>
              </a>
            )}
          </div>
        )}
      </Card>

      <div className="text-center mt-5">
        <Link to="/request" className="text-sm text-brand-deep font-medium">
          Looking for a product we do not stock? Request it →
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-brand-muted shrink-0">{label}</dt>
      <dd className="text-sm text-brand-ink text-right break-words">{value}</dd>
    </div>
  );
}
