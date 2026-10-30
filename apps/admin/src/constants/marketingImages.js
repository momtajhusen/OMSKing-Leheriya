// Image files live in apps/admin/public/marketing/<name>.png (webp / jpg also work).
// Sizes match what ChatGPT image generation produces, so nothing is cropped or stretched.
export const IMAGE_SIZES = {
  landscape: { width: 1536, height: 1024, label: 'landscape, 3:2' },
  square: { width: 1024, height: 1024, label: 'square, 1:1' },
  portrait: { width: 1024, height: 1536, label: 'portrait, 2:3' },
};

export const IMAGE_FOLDER = 'apps/admin/public/marketing/';

const ABOUT_OMSKING =
  'OMSKing is a multichannel order management system for Indian fashion brands. Its first customer is Leheriya Creations, a hand block-print ethnic-wear brand from Jaipur. Orders from Shopify, Amazon, Myntra, Flipkart, Meesho, AJIO and Nykaa land on one desk as one Master Order; stock is counted once across two warehouses, lines go to the warehouse or to artisan vendors, parcels ship with Delhivery and GST invoices follow.';

const PHOTO_STYLE =
  'Premium photorealistic editorial photograph for a modern SaaS website. Full-frame camera, 35mm lens, soft natural window daylight, gentle shadows, shallow depth of field, crisp focus on the main subject, high dynamic range, ultra-detailed, 4K quality. Calm, uncluttered, warm and optimistic mood.';

const ILLUSTRATION_STYLE =
  'Premium 3D isometric illustration for a modern SaaS website. Soft matte clay-like materials with subtle frosted-glass accents, smooth global illumination, soft ambient-occlusion shadows, clean light ivory background, crisp edges, ultra-detailed, 4K quality. Friendly, polished and uncluttered.';

const PALETTE =
  'Deep emerald green #0D5C45 as the main colour, fresh lime #84CC16 and teal #14B8A6 as accents, warm ivory and white #F3F8F5 for backgrounds. Small touches of Jaipur block-print pink and saffron only in fabrics and props.';

const RULES =
  'Strict rules: no text, letters, numbers, logos, brand names or watermarks anywhere. Screens, boxes, tags and labels show only abstract shapes, simple charts, table rows and coloured status pills. People are Indian, with natural skin tones and realistic faces and hands, in smart-casual or traditional Indian wear. No distorted objects, no clutter, no borders or frames around the image.';

const HERO_SLIDE_FRAMING =
  'Square image, shown at about 6:5 in the hero slider, so a little of the top and bottom may be cropped. A caption card covers the lower-left 40% of the frame: keep the person’s face, hands and the key action in the upper-right two-thirds, and keep the lower-left calm and softly blurred.';

const WIDE_BANNER =
  'This image is shown as a wide banner (about 3:1 on desktop). Keep every important object inside the middle horizontal band; the top and bottom 15% may be cropped.';

export const MARKETING_IMAGES = {
  'home-hero-studio': {
    page: 'Home',
    section: 'Hero slider — slide 1 of 5: every channel lands on one desk',
    size: 'square',
    style: 'photo',
    alt: 'Jaipur ethnic-wear brand founder checking all channel orders on one tablet',
    scene:
      'The first and main hero image of the website. A confident, smiling young Indian woman, founder of a Jaipur ethnic-wear brand, wearing an emerald-green hand block-printed kurta, stands in her bright studio holding a tablet. Small soft glowing order cards in different colours (emerald, saffron, pink, sky blue) float out of the air and gather into the tablet, showing that orders from many shops arrive on one screen. Behind her, softly blurred: rails of colourful block-printed kurtas and dupattas, wooden shelves with kraft parcels, warm sunlight through an arched Jaipur window.',
    crop: HERO_SLIDE_FRAMING,
  },
  'home-hero-stock': {
    page: 'Home',
    section: 'Hero slider — slide 2 of 5: stock is counted once',
    size: 'square',
    style: 'photo',
    alt: 'Warehouse staff scanning a kurta on tidy WH-001 shelves',
    scene:
      'A tidy, well-lit fashion warehouse aisle in Jaipur. A young Indian man in an emerald polo shirt scans the tag of a folded block-printed kurta with a handheld scanner; a soft green glow from the scanner. Wooden shelves behind him hold neatly folded kurtas in clear bins marked only with coloured dots. A small floating frosted-glass card near the shelf shows a simple lock icon and two filled dots, meaning two pieces are reserved and cannot be sold twice.',
    crop: HERO_SLIDE_FRAMING,
  },
  'home-hero-vendor': {
    page: 'Home',
    section: 'Hero slider — slide 3 of 5: no stock? a vendor gets the line',
    size: 'square',
    style: 'photo',
    alt: 'Jaipur artisan vendor accepting an assigned order on his phone',
    scene:
      'A small, warm Jaipur artisan workshop. A middle-aged Indian craftsman in a cotton kurta smiles as he taps “accept” on his smartphone (the screen shows only an abstract order card with a green check pill). On the wooden table in front of him: hand block-printing stamps, a freshly printed fabric and a neatly packed kraft parcel ready to dispatch.',
    crop: HERO_SLIDE_FRAMING,
  },
  'home-hero-shipping': {
    page: 'Home',
    section: 'Hero slider — slide 4 of 5: packed and shipped with Delhivery',
    size: 'square',
    style: 'photo',
    alt: 'Packed parcels handed to a courier at the studio door',
    scene:
      'At the bright doorway of a Jaipur fashion studio, a young Indian woman in an emerald kurta hands a stack of kraft parcels with plain white shipping labels (only barcodes and lines, no readable text) to a smiling courier in a plain red-and-grey uniform with no logos. A plain white delivery van with no branding is softly blurred outside in warm daylight.',
    crop: HERO_SLIDE_FRAMING,
  },
  'home-hero-invoice': {
    page: 'Home',
    section: 'Hero slider — slide 5 of 5: GST invoice and payout, matched',
    size: 'square',
    style: 'photo',
    alt: 'Accounts manager reviewing GST invoices and matched payouts',
    scene:
      'A calm, bright office corner. A young Indian accounts manager in smart-casual clothes sits at a desk smiling at a laptop that shows an abstract invoice layout and a list of rows with green check pills (payouts matched). Beside the laptop: a neatly printed invoice sheet with only abstract lines, a small stack of rupee coins, a calculator and a cup of chai.',
    crop: HERO_SLIDE_FRAMING,
  },
  'home-order-desk': {
    page: 'Home',
    section: 'Inside the order desk',
    size: 'landscape',
    style: 'photo',
    alt: 'Operations manager checking orders at a Jaipur fashion packing table',
    scene:
      'Inside a bright, modern Jaipur fashion-brand studio. In the foreground a confident Indian woman operations manager in her late 20s, wearing an emerald-green kurta, stands at a light-wood packing table and looks at an open laptop showing a clean green-and-white order dashboard. On the table: neatly folded hand block-printed kurtas and dupattas, kraft mailer boxes lined with emerald tissue paper, a small thermal label printer and a handheld barcode scanner. In the soft-focus background a colleague places parcels into bins on tidy wooden shelves. Main subject on the left two-thirds, calm space on the right.',
  },
  'home-audience-d2c': {
    page: 'Home',
    section: 'Built for — D2C brands on Shopify',
    size: 'landscape',
    style: 'photo',
    alt: 'Young fashion founder photographing a block-print kurta for her online store',
    scene:
      'A young Indian fashion founder in her own small studio photographs a hand block-printed kurta on a wooden hanger for her online store. A smartphone on a tripod, a soft ring light, rails of colourful ethnic wear behind her, and a laptop on the side showing an abstract green storefront product grid. Warm, aspirational, entrepreneurial.',
  },
  'home-audience-marketplace': {
    page: 'Home',
    section: 'Built for — Marketplace sellers',
    size: 'landscape',
    style: 'photo',
    alt: 'Dispatch corner with parcels sorted into colour-coded marketplace crates',
    scene:
      'An organised dispatch corner of an Indian fashion seller. Parcels sorted into four colour-coded crates (emerald, saffron, pink and teal) that stand for different marketplaces. A young Indian man in an emerald polo shirt scans a parcel with a handheld scanner, and a tablet on a stand shows several abstract order lists side by side.',
  },
  'home-audience-vendors': {
    page: 'Home',
    section: 'Built for — Brands with vendors',
    size: 'landscape',
    style: 'photo',
    alt: 'Jaipur artisan vendor handing a packed parcel to a courier',
    scene:
      'A small Jaipur artisan vendor workshop. An Indian craftsman in a simple cotton kurta hands a neatly packed parcel to a courier partner. Wooden hand block-printing stamps and fabric rolls on the table behind him; in his other hand a smartphone shows an abstract list of assigned orders with green check pills. Respectful, warm and real.',
  },
  'home-one-tenant': {
    page: 'Home',
    section: 'One tenant — channels, vendors, two warehouses',
    size: 'landscape',
    style: 'illustration',
    alt: 'One brand order desk connected to stores, marketplaces, two warehouses and vendors',
    scene:
      'One central modern white building with an emerald roof (the brand’s single order desk) on a soft ivory platform. Glowing emerald and lime paths connect it to small surrounding scenes: an online storefront kiosk, a row of marketplace stalls, two warehouses (one solid brick warehouse and one translucent glass virtual warehouse) and two small artisan vendor workshops. Tiny parcels travel along the paths. A subtle transparent dome over everything shows that this whole world is one private, locked company space.',
  },
  'features-dashboard-showcase': {
    page: 'Features',
    section: 'Feature showcase under the page hero',
    size: 'landscape',
    style: 'illustration',
    alt: 'Laptop, tablet and phone showing the OMSKing order dashboard',
    scene:
      'A premium 3D product render: an open silver laptop in the centre, a tablet on the left and a smartphone on the right, standing on a soft ivory surface in front of a gentle emerald gradient background. All three screens show a clean light-theme order management dashboard in emerald and white — KPI cards, a small bar chart, an order table with coloured status pills and a stock list. Small floating frosted-glass cards with simple icons (parcel, delivery truck, barcode, invoice) hover around the devices.',
    crop: 'Keep the devices centred with breathing room on all sides.',
  },
  'features-group-channels': {
    page: 'Features',
    section: 'Module group 01 — Channels & sync',
    size: 'landscape',
    style: 'illustration',
    alt: 'Seven sales channels sending orders into one synced order hub',
    scene:
      'Seven small rounded storefront portals (shopping bag, cart, shop front, phone shop and similar simple icons, each in a different soft colour) arranged in a gentle arc. Each sends tiny parcels along emerald light streams into one central rounded order hub with a circular sync arrow floating above it.',
    crop: WIDE_BANNER,
  },
  'features-group-access': {
    page: 'Features',
    section: 'Module group 02 — SaaS & access',
    size: 'landscape',
    style: 'illustration',
    alt: 'Secure company vault with separate lanes for each team role',
    scene:
      'A secure company space: a shield-shaped emerald glass gateway with a golden key in the centre. In front of it five role badges (crown, headset, parcel box, calculator, handshake) stand on five separate lanes, each lane walled by thin translucent glass panels so no lane crosses another.',
    crop: WIDE_BANNER,
  },
  'features-group-stock': {
    page: 'Features',
    section: 'Module group 03 — Catalog & stock',
    size: 'landscape',
    style: 'illustration',
    alt: 'Tidy warehouse shelves with one master tag linked to channel listings',
    scene:
      'A cut-away isometric warehouse with tidy shelves of neatly folded colourful kurtas in bins. A barcode scanning beam reads one garment tag. A larger floating master tag card connects with thin glowing lines to three smaller channel tags. Beside the shelves, stacked glowing emerald bars show a stock ledger.',
    crop: WIDE_BANNER,
  },
  'features-group-orders': {
    page: 'Features',
    section: 'Module group 04 — Orders to cash',
    size: 'landscape',
    style: 'illustration',
    alt: 'Order journey from packing to delivery van to invoice and payout',
    scene:
      'A left-to-right isometric journey on one emerald path: an order card, then a packing table with a kraft box, then an emerald delivery van, then the doorstep of an Indian home, then an invoice sheet and a small stack of rupee coins returning to a wallet. A small return-arrow loop curves back under the van.',
    crop: WIDE_BANNER,
  },
  'features-group-setup': {
    page: 'Features',
    section: 'Module group 05 — Setup & integrations',
    size: 'landscape',
    style: 'illustration',
    alt: 'Settings gear surrounded by notification, connector and key icons',
    scene:
      'A clean control-panel concept: a large central settings gear in emerald frosted glass, surrounded by floating toggle switches, a bell with small notification dots, a plug connecting into a socket, curved connector cables and a golden key.',
    crop: WIDE_BANNER,
  },
  'pricing-growth': {
    page: 'Pricing',
    section: 'Pay per order, grow at your pace',
    size: 'landscape',
    style: 'photo',
    alt: 'Brand owners reviewing order growth beside packed parcels',
    scene:
      'An Indian couple who run a growing ethnic-wear brand sit at a bright office table, smiling with confidence while reviewing a laptop that shows an abstract upward green growth chart. A neat stack of packed kraft parcels and a cup of chai beside them, block-print fabric samples on the table.',
  },
  'demo-walkthrough': {
    page: 'Demo',
    section: 'What happens next (above the steps)',
    size: 'landscape',
    style: 'photo',
    alt: 'Product specialist giving a friendly video walkthrough of the order desk',
    scene:
      'A friendly Indian product specialist wearing a light headset sits at a clean desk in a bright office, smiling while giving a video walkthrough. The large monitor shows an abstract emerald order dashboard with a small video-call tile of a client in the corner. Plants and soft daylight in the background.',
  },
  'about-jaipur-studio': {
    page: 'About',
    section: 'Our story — born in Jaipur',
    size: 'landscape',
    style: 'photo',
    alt: 'Sunlit Jaipur fashion studio with block-print fabrics and a packing station',
    scene:
      'A wide view of a sunlit Jaipur fashion studio inside a heritage haveli: arched windows with jharokha details, soft pink sandstone walls, long tables with hand block-printed fabrics in indigo, pink and saffron, carved wooden printing blocks, and a modern laptop and packing station blending naturally with the traditional craft. A small team of Indian artisans and operations staff at work.',
  },
  'about-journey-packing-table': {
    page: 'About',
    section: 'Journey — Where it started',
    size: 'landscape',
    style: 'photo',
    alt: 'Close-up of a wooden packing table with a folded kurta and kraft box',
    scene:
      'Close-up of a wooden packing table under warm overhead light: a blank order slip with abstract lines, a folded hand block-printed kurta, an open kraft box with emerald tissue, and two small storage bins marked only with coloured dots.',
  },
  'about-journey-stock-ledger': {
    page: 'About',
    section: 'Journey — Master SKU and stock ledger',
    size: 'landscape',
    style: 'illustration',
    alt: 'Garment tag linked to a stock ledger between two warehouses',
    scene:
      'A garment tag with a barcode connected by glowing lines to a stacked ledger book made of emerald glass tiles. Two small warehouse buildings stand on either side, and a small padlock on the ledger shows the same unit can never be sold twice.',
  },
  'about-journey-vendor-network': {
    page: 'About',
    section: 'Journey — Vendor portal and per-item assign',
    size: 'landscape',
    style: 'illustration',
    alt: 'Miniature Jaipur rooftops with artisan workshops linked to a central studio',
    scene:
      'An isometric miniature of Jaipur rooftops in soft pink sandstone, with small artisan workshops connected by glowing emerald dotted routes to one central studio. Tiny parcels and a courier scooter move along the routes.',
  },
  'about-journey-seven-channels': {
    page: 'About',
    section: 'Journey — Seven channels on one desk',
    size: 'landscape',
    style: 'illustration',
    alt: 'Seven channel tiles beaming orders into one central order desk',
    scene:
      'Seven floating rounded tiles in different soft colours (emerald, saffron, pink, sky blue, violet, amber, teal), each with a simple shopping icon, all connected by light beams into one glowing emerald laptop desk at the centre. A subtle celebratory sparkle in the air.',
  },
  'contact-support-team': {
    page: 'Contact',
    section: 'Reach us — support team',
    size: 'landscape',
    style: 'photo',
    alt: 'Friendly support team ready to help at a Jaipur office desk',
    scene:
      'A warm Indian support team of two at a bright Jaipur office desk: a woman with a light headset and a man holding a smartphone that shows a simple chat bubble, a laptop open between them, both smiling and ready to help. A jharokha window and green plants in the soft-focus background.',
  },
  'login-hero': {
    page: 'Login',
    section: 'Sign-in — large photo in the left panel',
    size: 'landscape',
    style: 'photo',
    alt: 'Leheriya team starting the day at the order desk with every channel on one screen',
    scene:
      'Morning at a bright, premium Jaipur fashion brand studio. A young Indian woman in an emerald block-printed kurta sits at a wooden order desk and opens a laptop showing an abstract green dashboard with order rows and soft charts. Beside her, a colleague places a neatly packed kraft parcel with emerald tissue on a stack of ready orders. Rails of colourful block-printed kurtas and dupattas, and warm sunlight through an arched jharokha window, in soft focus behind them. Calm, confident start-of-day mood.',
    crop: 'Shown in a wide frame that becomes about 2:1 on smaller laptops, on a dark emerald panel. Small floating cards sit on the top-left and bottom-right corners. Keep both people and the laptop in the centre band and leave calm space near the corners.',
  },
};

export function imageSources(name, uploadedUrl = '') {
  const bundled = ['png', 'webp', 'jpg'].map((ext) => `/marketing/${name}.${ext}`);
  return uploadedUrl ? [uploadedUrl, ...bundled] : bundled;
}

export const MARKETING_PAGES = [
  { page: 'Home', path: '/' },
  { page: 'Features', path: '/features' },
  { page: 'Pricing', path: '/pricing' },
  { page: 'Demo', path: '/demo' },
  { page: 'About', path: '/about' },
  { page: 'Contact', path: '/contact' },
  { page: 'Login', path: '/auth/login' },
];

export function imagesByPage() {
  const names = Object.keys(MARKETING_IMAGES);
  return MARKETING_PAGES.map((item) => ({
    ...item,
    names: names.filter((name) => MARKETING_IMAGES[name].page === item.page),
  }));
}

export function imagePrompt(name) {
  const spec = MARKETING_IMAGES[name];
  const size = IMAGE_SIZES[spec.size];
  return [
    `Image name: ${name}.png`,
    `Size: ${size.width} × ${size.height} px (${size.label}). Generate exactly this aspect ratio.`,
    `Where it is used: OMSKing website — ${spec.page} page, “${spec.section}” section.`,
    `About the product: ${ABOUT_OMSKING}`,
    `Scene: ${spec.scene}`,
    spec.crop ? `Framing: ${spec.crop}` : null,
    `Style: ${spec.style === 'illustration' ? ILLUSTRATION_STYLE : PHOTO_STYLE}`,
    `Colours: ${PALETTE}`,
    RULES,
  ].filter(Boolean).join('\n\n');
}
