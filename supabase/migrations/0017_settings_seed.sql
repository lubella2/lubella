-- ============================================================================
-- LuBella  |  Migration 0017 — Default settings
-- ============================================================================
-- Customer-visible configuration lives in PUBLIC rows, so the catalog and the
-- WhatsApp/Telegram message builders can read it without exposing anything
-- else. The owner edits these from Settings; nothing here is hard-coded in a
-- React component (spec §14, §15).
-- ============================================================================

insert into public.settings (key, value, is_public, description) values
  ('shop_name',            '"LuBella Cosmetics & Accessories"'::jsonb, true,  'Business name shown across the app and on receipts'),
  ('shop_tagline',         '"Cosmetics & Accessories"'::jsonb,         true,  'Strapline under the wordmark'),
  ('currency',             '"ETB"'::jsonb,                             true,  'Shop currency code'),
  ('currency_label',       '"Birr"'::jsonb,                            true,  'How the currency is written on receipts and in messages'),
  ('whatsapp_number',      '"+251900000000"'::jsonb,                   true,  'LuBella WhatsApp number in international format — used to build order links'),
  ('whatsapp_display',     '"09 00 00 00 00"'::jsonb,                  true,  'Human-readable WhatsApp number for the Contact page'),
  ('telegram_username',    '"lubella_shop"'::jsonb,                    true,  'Public Telegram username for orders'),
  ('telegram_bot_username','"lubella_orders_bot"'::jsonb,              true,  'Telegram bot customers can start an order with'),
  ('telegram_order_destination', '"OWNER_DM"'::jsonb,                  true,  'Where bot orders are delivered: OWNER_DM or GROUP'),
  ('support_hours',        '"Mon–Sat, 8:30am – 7:00pm"'::jsonb,        true,  'Shown on the Contact page'),
  ('phone',                '"+251 900 000 000"'::jsonb,                true,  'Shop phone number'),
  ('email',                '"hello@lubella.shop"'::jsonb,              true,  'Shop email address'),
  ('address',              '"Addis Ababa, Ethiopia"'::jsonb,           true,  'Shop address'),
  ('instagram',            '"@lubella.shop"'::jsonb,                   true,  'Instagram handle'),
  ('tiktok',               '"@lubella.shop"'::jsonb,                   true,  'TikTok handle'),
  ('expiry_warning_days',  '30'::jsonb,                                true,  'How many days ahead a product counts as expiring soon'),
  ('low_stock_band',       '"per_product"'::jsonb,                     true,  'Low stock is judged against each product''s own minimum stock'),
  ('tithe_rate',           '0.10'::jsonb,                              true,  'Tithe rate applied to net profit'),
  ('commission_rate',      '0.03'::jsonb,                              true,  'Default staff commission rate'),

  -- Private rows: never exposed to anon, never rendered in the customer portal.
  ('telegram_bot_token',   'null'::jsonb,                              false, 'Telegram bot token. Server-side only — never sent to a browser.'),
  ('order_message_footer', '"Thank you."'::jsonb,                      false, 'Closing line appended to generated order messages'),
  ('receipt_footer',       '"Thank you for shopping with LuBella!"'::jsonb, true, 'Printed at the bottom of every receipt'),
  ('backup_schedule',      '"weekly"'::jsonb,                          false, 'Automatic backup cadence')
on conflict (key) do nothing;
