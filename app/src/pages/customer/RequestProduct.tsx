import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Field, Input, SectionHeader, Select, Textarea, useToast } from '../../components/ui';
import { submitRequest } from '../../api/portal';
import { supabase } from '../../lib/supabase';
import type { ContactLinks, RequestSource } from '../../types';

/**
 * Request an unavailable product (§10).
 *
 * This is the demand signal that drives purchasing decisions: it is recorded
 * against the product so the owner sees "N customers requested this" at the
 * moment they are deciding what to buy (§13).
 */
export default function CustomerRequest() {
  const [params] = useSearchParams();
  const { push } = useToast();

  const [productName, setProductName] = useState(params.get('product') || '');
  const [productId] = useState<string | null>(params.get('productId'));
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<'whatsapp' | 'telegram' | null>(null);
  const [result, setResult] = useState<{ request_number: string; links: ContactLinks; was_unavailable: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const p = params.get('product');
    if (p) setProductName(p);
  }, [params]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!productName.trim()) next.productName = 'Tell us which product you would like.';
    if (!/^[0-9+\s-]{7,}$/.test(phone.trim())) next.phone = 'A phone number is needed so we can tell you when it arrives.';
    if (quantity < 1) next.quantity = 'At least one.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `requests/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(path, file, { upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
      push({ tone: 'success', title: 'Photo attached' });
    } catch (err) {
      push({ tone: 'error', title: 'Photo could not be attached', body: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const submit = async (channel: 'whatsapp' | 'telegram') => {
    if (!validate()) return;
    setBusy(channel);
    try {
      // The request is always recorded (source WEB on the website), then the
      // channel chosen by the customer determines where the message is sent.
      const source: RequestSource = channel === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM';
      const res = await submitRequest({
        productName: productName.trim(),
        quantity,
        customerName: name.trim() || undefined,
        customerPhone: phone.trim(),
        productId,
        message: message.trim() || undefined,
        photoUrl,
        source,
      });
      setResult({ request_number: res.request_number, links: res.links, was_unavailable: res.was_unavailable });

      const url = channel === 'whatsapp' ? res.links.whatsapp_url : res.links.telegram_url;
      if (url) window.open(url, '_blank', 'noopener');
      push({
        tone: 'success',
        title: `Request ${res.request_number} saved`,
        body: 'Send the message and we will get back to you.',
      });
    } catch (err) {
      push({ tone: 'error', title: 'Request not sent', body: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <h1 className="text-xl font-semibold text-brand-ink">Request a product</h1>
      <p className="text-sm text-brand-muted mt-1 mb-4">
        Looking for something we do not have? Tell us and we will let you know when it is in stock.
      </p>

      {result ? (
        <Card>
          <div className="text-center py-3">
            <p className="text-4xl" aria-hidden="true">💌</p>
            <h2 className="font-semibold text-brand-ink mt-2">Request received</h2>
            <p className="text-sm text-brand-muted mt-1">
              Reference <strong className="text-brand-charcoal">{result.request_number}</strong>
            </p>
            <p className="text-sm text-brand-charcoal mt-3">
              {result.was_unavailable
                ? 'This item is currently unavailable — we will message you as soon as it arrives.'
                : 'We have your request and will confirm availability shortly.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center mt-3">
            {result.links.whatsapp_url && (
              <a href={result.links.whatsapp_url} target="_blank" rel="noopener noreferrer">
                <Button variant="whatsapp" size="sm">Open WhatsApp</Button>
              </a>
            )}
            {result.links.telegram_url && (
              <a href={result.links.telegram_url} target="_blank" rel="noopener noreferrer">
                <Button variant="telegram" size="sm">Open Telegram</Button>
              </a>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => {
                setResult(null); setProductName(''); setQuantity(1);
                setMessage(''); setPhotoUrl(null); setPhone(''); setName('');
              }}
            >
              Make another request
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <Field label="Product name" required error={errors.productName}
            hint="Even if you are not sure of the exact name, describe it as best you can.">
            <Input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Foundation, matte, medium shade"
            />
          </Field>

          <Field label="Quantity" required error={errors.quantity}>
            <Select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>

          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara" autoComplete="name" />
            </Field>
            <Field label="Phone number" required error={errors.phone} hint="So we can reach you.">
              <Input
                value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="09XXXXXXXX" inputMode="tel" autoComplete="tel"
              />
            </Field>
          </div>

          <Field label="Anything else?" hint="Shade, size, brand, or a link to a photo.">
            <Textarea
              value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional details"
            />
          </Field>

          <Field label="Reference photo" hint="Optional — a screenshot or a photo of the product.">
            <div className="flex items-center gap-3">
              <label className="btn-secondary btn cursor-pointer">
                {uploading ? 'Uploading…' : 'Choose photo'}
                <input
                  type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPhoto(f);
                  }}
                />
              </label>
              {photoUrl && (
                <div className="flex items-center gap-2">
                  <img src={photoUrl} alt="Reference" className="h-12 w-12 rounded-lg object-cover border border-brand-line" />
                  <button onClick={() => setPhotoUrl(null)} className="text-xs text-state-red hover:underline">Remove</button>
                </div>
              )}
            </div>
          </Field>

          <div className="border-t border-brand-line pt-4 mt-2">
            <SectionHeader title="Send your request" />
            <div className="space-y-2.5">
              <Button
                variant="whatsapp" className="w-full" loading={busy === 'whatsapp'}
                onClick={() => submit('whatsapp')}
              >
                Request via WhatsApp
              </Button>
              <Button
                variant="telegram" className="w-full" loading={busy === 'telegram'}
                onClick={() => submit('telegram')}
              >
                Request via Telegram
              </Button>
            </div>
            <p className="text-xs text-brand-muted mt-3">
              Sending opens your own WhatsApp or Telegram with the message ready to send.
              Your request is saved either way, so we can notify you when the product arrives.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
