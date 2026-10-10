import { Link, useLocation } from 'react-router-dom';
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY } from '../../components/marketing/StickyContactDock';

export const LEGAL_LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/billing', label: 'Billing' },
  { to: '/cookies', label: 'Cookies' },
];

const UPDATED = '10 October 2026';

const DOCS = {
  '/terms': {
    title: 'Terms of use',
    lede: 'These terms cover the OMSKing order system: one company account, its channels, its users, and the monthly subscription billed from its orders.',
    sections: [
      {
        heading: 'The service',
        body: [
          'OMSKing is a multi-company order system. Each company is a separate tenant. Leheriya Creations is the first tenant. A Super Admin, operations user, or vendor of one company does not see another company’s orders, stock, or settings.',
          'The service includes order pull from the channels that company connects, packing and shipping screens, GST invoice data the company saves, vendor assignment, and the subscription bill on Admin → Subscription.',
        ],
      },
      {
        heading: 'Accounts',
        body: [
          'A new company does not receive a session until the signup email OTP matches. The Super Admin is responsible for the people they invite and for the roles they grant.',
          'Sign-in OTP, when turned on, is an email code from that company’s Gmail if one is saved, otherwise from the OMSKing mailbox. Passwords are stored as a hash. Temporary passwords in an invite mail must be changed.',
        ],
      },
      {
        heading: 'Trial and subscription',
        body: [
          'A new company starts on a trial. The length is the number of days saved by the Platform Admin (the default in the product is 14). When the trial date has passed, sign-in stays closed until the platform records that month’s subscription payment.',
          'The monthly bill counts orders created in that calendar month, except cancelled orders. The amount is the higher of the minimum monthly charge and orders × the slab rate on the rate card. The company sees the channel split, the bill number, and the amount on Admin → Subscription.',
          'Payment follows the Billing page. Marking a month paid is done by the Platform Admin, or automatically when a Razorpay payment for that month is verified.',
        ],
      },
      {
        heading: 'Your channels and warehouse',
        body: [
          'You may connect only marketplace and store accounts you are allowed to use. Shopify, Amazon, Myntra, and any other channel you save are used to read orders and, where that connection supports it, to update fulfilment for that company.',
          'API tokens, refresh tokens, and courier keys are stored encrypted. The screen does not show a saved secret again. You can replace a secret by entering a new one.',
          'Warehouse names, GSTIN, and HSN rates you save are your company’s records. GST invoices use the company profile and the order.',
        ],
      },
      {
        heading: 'Vendors and staff',
        body: [
          'A vendor login sees the order lines assigned to that vendor. It does not open another vendor’s cost, the company finance screens, or platform settings.',
          'You must not upload another person’s personal data except what you need to fulfil an order you are handling, and you must have a proper reason to hold that data.',
        ],
      },
      {
        heading: 'Suspension',
        body: [
          'The Platform Admin can suspend a company. A suspended company cannot sign in. Suspension is separate from an unpaid bill. An active unpaid company can still sign in and sees the amount due.',
        ],
      },
      {
        heading: 'What we do not do',
        body: [
          'OMSKing is not a card vault. Do not store card numbers or UPI PINs in notes, SKUs, or order comments. Order payment mode, such as COD or prepaid, is an operations field.',
          'Connecting a channel does not transfer ownership of your catalog or your marketplace account to OMSKing.',
        ],
      },
    ],
  },
  '/privacy': {
    title: 'Privacy policy',
    lede: 'This page says what OMSKing stores so a company can run orders, and what is not used for advertising.',
    sections: [
      {
        heading: 'Who decides',
        body: [
          'The merchant company decides why its customer and order data is processed: to take the order, pack it, ship it, invoice it, and handle a return. OMSKing stores and shows that data inside that company’s tenant only.',
          'Platform Admin settings (the OMSKing mailbox, trial length, rate card, and payment instructions) are operated for the service itself.',
        ],
      },
      {
        heading: 'Account and company profile',
        body: [
          'We store the company name, the owner’s name, email, phone, and a password hash. Signup, password reset, and sign-in OTP codes are kept only until they expire or are used.',
          'Company settings can include GSTIN, PAN, address, city, district, support email, support phone, and a company Gmail address. A Gmail app password, when saved, is encrypted. It is used to send that company’s own reset, invite, and sign-in OTP. It is not used for another company.',
        ],
      },
      {
        heading: 'Orders and people on the order',
        body: [
          'When a channel is connected, OMSKing stores the order the channel sends: order number, channel, items, amounts, status, and the customer name, phone, and address on that order. That data stays on the company that connected the channel.',
          'Cancelled orders stay in the order list where the screen includes them. They are left out of the subscription order count.',
        ],
      },
      {
        heading: 'Secrets',
        body: [
          'Channel tokens, courier API tokens, WhatsApp tokens, Telegram bot tokens, and mailbox app passwords are encrypted. API responses for settings do not return the saved secret. A blank password field on save keeps the saved secret.',
        ],
      },
      {
        heading: 'Subscription and messages',
        body: [
          'We store the month, the order count used for the bill, the amount, and either a UPI reference the company submits or a Razorpay payment id when checkout is used.',
          'Email is sent through Gmail using the mailbox configured for that message. WhatsApp and Telegram are used only when that company has saved those credentials and switched the event on. Demo and pricing forms store the name, email, phone, company, and message you type.',
        ],
      },
      {
        heading: 'Session',
        body: [
          'The browser keeps the access token in local storage and a refresh session so you stay signed in. Theme choice may also be stored on the device. We do not run an advertising cookie or sell this data.',
          'Razorpay’s checkout script loads only after a company clicks Pay and Razorpay keys are saved. That script is Razorpay’s, used to collect the subscription payment.',
        ],
      },
      {
        heading: 'Access and correction',
        body: [
          'A company Super Admin can correct the company profile, users, and channel connections in Settings. To close a company or ask for a copy of what is stored, write to the contact below. Platform staff who open a company do so through an impersonation bar that stays on screen.',
        ],
      },
    ],
  },
  '/billing': {
    title: 'Billing',
    lede: 'How an OMSKing company is charged for the month, how it pays, and when the month shows Paid.',
    sections: [
      {
        heading: 'What is billed',
        body: [
          'The bill is for the OMSKing subscription, not for the customer’s order payment. Customer COD and prepaid totals stay on the order. They are not the subscription fee.',
          'Counted orders are those created in the current calendar month, excluding cancelled orders. The rate comes from the slab that matches that count. The amount due is the higher of that usage and the minimum monthly charge on the rate card.',
        ],
      },
      {
        heading: 'What the company sees',
        body: [
          'Admin → Subscription shows the plan, the month, orders by channel, cancelled orders left out, the per-order rate, the minimum, and the amount due. Print bill opens that same breakdown.',
          'A banner on the company admin repeats the short bill message until the month is paid.',
        ],
      },
      {
        heading: 'How to pay',
        body: [
          'The Platform Admin saves the receiving UPI id, account name, account number, IFSC, bank, and a note on Platform → Plans. Those details appear on the company’s bill. Open UPI app fills the amount and the UPI id. After you pay, enter the UPI reference and choose I have paid.',
          'That reference does not by itself mark the month paid. The Platform Admin confirms it. If Razorpay keys are saved, Pay opens UPI checkout and a verified payment marks the month paid without a separate confirm.',
          'A trial company that is marked paid becomes an active company for the rest of that month. A suspended company is not offered payment inside the app.',
        ],
      },
      {
        heading: 'After the trial',
        body: [
          'When the trial end date has passed, sign-in is refused. The message includes the current bill and the payment line, and says sign-in opens after the platform records the payment.',
        ],
      },
      {
        heading: 'Corrections',
        body: [
          'There is no self-serve refund button. If a month was confirmed in error, the Platform Admin is the person who can correct the standing. Write to the contact below with the bill number and the UPI reference or Razorpay payment id.',
        ],
      },
    ],
  },
  '/cookies': {
    title: 'Cookies and local storage',
    lede: 'OMSKing keeps a sign-in session on your browser. It does not drop advertising cookies.',
    sections: [
      {
        heading: 'What is stored',
        body: [
          'After sign-in, the access token is kept in local storage so the admin screens can call the API. A refresh session keeps you signed in when that token expires. Signing out clears the token.',
          'The theme you pick (light or dark) can be stored on the device. Marketing pages force a light background while you are on them.',
        ],
      },
      {
        heading: 'What is not stored',
        body: [
          'Public pages do not set an advertising or analytics cookie. A demo form or pricing form sends the fields you submit to the API. It does not follow you across other websites.',
          'Razorpay may set its own cookies only if you open Pay on a company that has Razorpay turned on. That is the payment window, not an OMSKing marketing tag.',
        ],
      },
      {
        heading: 'Your choice',
        body: [
          'You can clear site data in the browser. Clearing it signs you out. The company record, orders, and subscription bill stay on the server until the company is closed.',
        ],
      },
    ],
  },
};

function Related({ current }) {
  return (
    <nav className="mt-12 border-t border-slate-200 pt-6" aria-label="Related policies">
      <p className="text-sm font-semibold text-slate-900">Related</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        {LEGAL_LINKS.filter((item) => item.to !== current).map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="font-medium text-emerald-800 underline-offset-2 hover:underline">{item.label}</Link>
          </li>
        ))}
        <li><Link to="/contact" className="font-medium text-emerald-800 underline-offset-2 hover:underline">Contact</Link></li>
      </ul>
    </nav>
  );
}

export default function LegalPage() {
  const { pathname } = useLocation();
  const doc = DOCS[pathname] || DOCS['/terms'];

  return (
    <article className="bg-white">
      <header className="bg-gradient-to-br from-emerald-50 via-white to-lime-50 py-14 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <p className="text-sm font-semibold tracking-wide text-emerald-800">OMSKing</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-900">{doc.title}</h1>
          <p className="mt-3 text-sm text-slate-500">Last updated {UPDATED} · Jaipur, India</p>
          <p className="mt-4 text-lg leading-8 text-slate-600">{doc.lede}</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="space-y-10">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-bold text-slate-900">{section.heading}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-slate-600">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
        <section className="mt-10 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
          <h2 className="text-base font-bold text-slate-900">Contact</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Questions about these pages, a company account, or a bill:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-emerald-800 underline-offset-2 hover:underline">{CONTACT_EMAIL}</a>
            {' · '}
            <a href="tel:+917600201227" className="font-medium text-emerald-800 underline-offset-2 hover:underline">{CONTACT_PHONE_DISPLAY}</a>
            {' · Jaipur, Rajasthan.'}
          </p>
        </section>
        <Related current={pathname} />
      </div>
    </article>
  );
}
