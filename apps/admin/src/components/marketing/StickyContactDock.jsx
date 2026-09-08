import { Mail, Phone } from 'lucide-react';

const PHONE = '7600201227';
const PHONE_E164 = '917600201227';
const EMAIL = 'thecodersalpha@gmail.com';

function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.52 3.48A11.86 11.86 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.65a11.86 11.86 0 0 0 5.75 1.47h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.17-3.43-8.44zM12.06 21.8h-.01a9.86 9.86 0 0 1-5.02-1.38l-.36-.21-3.74.98 1-3.64-.24-.37a9.86 9.86 0 0 1-1.51-5.28c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.82 9.82 0 0 1 2.89 6.98c0 5.44-4.43 9.87-9.87 9.87zm5.42-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15s-.77.97-.95 1.17c-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48a8.96 8.96 0 0 1-1.66-2.06c-.17-.3-.02-.46.13-.6.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.05 1.02-1.05 2.5s1.08 2.9 1.23 3.1c.15.2 2.12 3.24 5.14 4.54.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.07-.12-.27-.2-.57-.35z" />
    </svg>
  );
}

const ITEMS = [
  {
    id: 'call',
    href: `tel:+${PHONE_E164}`,
    label: PHONE,
    aria: `Call ${PHONE}`,
    well: 'contact-fab--call',
    Icon: Phone,
  },
  {
    id: 'whatsapp',
    href: `https://wa.me/${PHONE_E164}`,
    label: 'WhatsApp',
    aria: 'Chat on WhatsApp',
    well: 'contact-fab--wa',
    Icon: WhatsAppIcon,
    external: true,
  },
  {
    id: 'gmail',
    href: `mailto:${EMAIL}`,
    label: 'Gmail',
    aria: `Email ${EMAIL}`,
    well: 'contact-fab--mail',
    Icon: Mail,
  },
];

export const CONTACT_ITEMS = ITEMS;

export default function StickyContactDock() {
  return (
    <nav aria-label="Quick contact" className="contact-dock">
      {ITEMS.map((item) => {
        const Icon = item.Icon;
        return (
          <a
            key={item.id}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noopener noreferrer' : undefined}
            aria-label={item.aria}
            className={`contact-fab ${item.well}`}
          >
            <span className="contact-fab-label">{item.label}</span>
            <span className="contact-fab-icon">
              <Icon className="h-[18px] w-[18px]" />
            </span>
          </a>
        );
      })}
    </nav>
  );
}
