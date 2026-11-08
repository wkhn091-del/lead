import { Compass, ExternalLink, Mail, MapPinned, MessageCircle, PhoneCall, Store, UserRound, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { isValidEmail } from '../../lib/email';
import { isValidMapsUrl, mapsLink } from '../../lib/maps';
import { isValidPhone, telHref, whatsAppHref } from '../../lib/phone';
import { CHANNEL_OPTIONS } from '../../lib/stages';
import { isValidWebsite, websiteHref } from '../../lib/website';
import { useLeadStore } from '../../store/leads';
import type { Lead } from '../../types';
import { Button, buttonStyles } from '../ui/Button';
import { Field } from '../ui/Field';
import { FormSection } from '../ui/FormSection';
import { InlineInput } from '../ui/InlineInput';
import { InlineTextarea } from '../ui/InlineTextarea';
import { Segmented } from '../ui/Segmented';
import { DealSection } from './DealSection';

/**
 * Everything about the lead, in the groups the New Lead form uses: the business and the person to talk to on
 * one side, the strategy and the deal on the other. Every field saves in place.
 */
export function DetailsPanel({ lead }: { lead: Lead }) {
  const updateLead = useLeadStore((s) => s.updateLead);
  const fieldId = (field: string) => `lead-${lead.id}-${field}`;

  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-8">
        <FormSection titleId={fieldId('about')} title="העסק" icon={Store}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="שם העסק" htmlFor={fieldId('name')} className="sm:col-span-2">
              <InlineInput
                id={fieldId('name')}
                dir="auto"
                autoComplete="off"
                value={lead.name}
                validate={(text) => (text ? null : 'שם העסק לא יכול להיות ריק.')}
                onCommit={(name) => updateLead(lead.id, { name })}
              />
            </Field>
            <Field label="קמפיין / נישה" htmlFor={fieldId('campaign')}>
              <InlineInput
                id={fieldId('campaign')}
                dir="auto"
                autoComplete="off"
                list="campaign-options"
                placeholder="למשל: רופאי שיניים"
                value={lead.campaign}
                onCommit={(campaign) => updateLead(lead.id, { campaign })}
              />
            </Field>
            <Field label="עיר" htmlFor={fieldId('city')}>
              <InlineInput
                id={fieldId('city')}
                dir="auto"
                autoComplete="off"
                list="city-options"
                placeholder="למשל: ירושלים"
                value={lead.city ?? ''}
                validate={(text) => (text.length <= 60 ? null : 'עד 60 תווים.')}
                onCommit={(city) => updateLead(lead.id, { city })}
              />
            </Field>
            <ContactRow label="האתר הנוכחי" id={fieldId('website')} className="sm:col-span-2">
              <InlineInput
                id={fieldId('website')}
                inputMode="url"
                autoComplete="off"
                dir="ltr"
                placeholder="business.co.il"
                value={lead.website}
                className="min-w-0 flex-1 [&_input]:text-right"
                validate={(text) => (!text || isValidWebsite(text) ? null : 'נא להזין אתר, למשל business.co.il.')}
                onCommit={(website) => updateLead(lead.id, { website })}
              />
              <ContactLink href={websiteHref(lead.website)} label="פתיחה" icon={ExternalLink} missing="קודם צריך כתובת אתר" external />
            </ContactRow>
            <ContactRow label="גוגל מפות" id={fieldId('maps')} className="sm:col-span-2">
              <InlineInput
                id={fieldId('maps')}
                inputMode="url"
                autoComplete="off"
                dir="ltr"
                placeholder="https://maps.app.goo.gl/…"
                value={lead.mapsUrl ?? ''}
                className="min-w-0 flex-1 [&_input]:text-right"
                validate={(text) => (!text || isValidMapsUrl(text) ? null : 'נא להדביק קישור שמתחיל ב-https://')}
                onCommit={(mapsUrl) => updateLead(lead.id, { mapsUrl })}
              />
              <MapsButton lead={lead} />
            </ContactRow>
          </div>
        </FormSection>

        <FormSection titleId={fieldId('person')} title="איש הקשר" icon={UserRound}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="איש קשר" htmlFor={fieldId('contact')}>
              <InlineInput
                id={fieldId('contact')}
                dir="auto"
                autoComplete="off"
                placeholder="עם מי מדברים"
                value={lead.contactName}
                onCommit={(contactName) => updateLead(lead.id, { contactName })}
              />
            </Field>
            <Field label="ערוץ מועדף">
              <Segmented label="ערוץ מועדף" value={lead.method} options={CHANNEL_OPTIONS} onChange={(method) => updateLead(lead.id, { method })} />
            </Field>
            <ContactRow label="טלפון" id={fieldId('phone')} className="sm:col-span-2">
              <InlineInput
                id={fieldId('phone')}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                dir="ltr"
                placeholder="05X-XXX-XXXX"
                value={lead.phone}
                className="min-w-0 flex-1 [&_input]:text-right"
                validate={(text) => (!text || isValidPhone(text) ? null : 'נא להזין מספר טלפון עם 9 ספרות לפחות.')}
                onCommit={(phone) => updateLead(lead.id, { phone })}
              />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <ContactLink href={telHref(lead.phone)} label="חיוג" icon={PhoneCall} missing="קודם צריך מספר טלפון" />
                <ContactLink
                  href={whatsAppHref(lead.phone)}
                  label="וואטסאפ"
                  icon={MessageCircle}
                  iconColor="var(--whatsapp)"
                  missing="קודם צריך מספר טלפון"
                  external
                />
              </div>
            </ContactRow>
            <ContactRow label="אימייל" id={fieldId('email')} className="sm:col-span-2">
              <InlineInput
                id={fieldId('email')}
                type="email"
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                placeholder="name@business.co.il"
                value={lead.email}
                className="min-w-0 flex-1 [&_input]:text-right"
                validate={(text) => (!text || isValidEmail(text) ? null : 'נא להזין כתובת אימייל, למשל name@business.co.il.')}
                onCommit={(email) => updateLead(lead.id, { email })}
              />
              <ContactLink href={isValidEmail(lead.email) ? `mailto:${lead.email}` : null} label="אימייל" icon={Mail} missing="קודם צריך כתובת אימייל" />
            </ContactRow>
          </div>
        </FormSection>
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <FormSection titleId={fieldId('strategy')} title="אסטרטגיה" icon={Compass}>
          <InlineTextarea
            id={fieldId('approach')}
            aria-labelledby={fieldId('strategy')}
            dir="auto"
            rows={5}
            value={lead.approach}
            placeholder="מה הכאב שלהם, מה להציע, ואיך לפתוח את השיחה"
            onCommit={(approach) => updateLead(lead.id, { approach })}
          />
        </FormSection>

        <DealSection lead={lead} />
      </div>
    </div>
  );
}

/** Opens the stored listing, or, with none, a search for the business by its name and city */
function MapsButton({ lead }: { lead: Lead }) {
  const maps = mapsLink(lead);
  return (
    <ContactLink
      href={maps?.href ?? null}
      label={maps?.search ? 'חיפוש' : 'פתיחה'}
      icon={MapPinned}
      iconColor="var(--st-lost)"
      missing="קודם צריך קישור למפות, או עיר"
      external
    />
  );
}

function ContactRow({ label, id, className, children }: { label: string; id: string; className?: string; children: ReactNode }) {
  return (
    <Field label={label} htmlFor={id} className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">{children}</div>
    </Field>
  );
}

interface ContactLinkProps {
  href: string | null;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  missing: string;
  external?: boolean;
}

/** Opens your own phone, WhatsApp or mail app on the lead. Nothing is written or sent for you. */
function ContactLink({ href, label, icon: Icon, iconColor, missing, external }: ContactLinkProps) {
  const content = (
    <>
      <Icon className="size-4" style={iconColor ? { color: iconColor } : undefined} aria-hidden />
      {label}
    </>
  );
  if (!href) {
    return (
      <Button disabled title={missing}>
        {content}
      </Button>
    );
  }
  return (
    <a href={href} className={buttonStyles()} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
      {content}
    </a>
  );
}
