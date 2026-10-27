/**
 * Words the generator uses when the owner hasn't given us their own yet.
 *
 * Service descriptions say what the service *is*, never how good this business is at it
 * ("fast", "best", "guaranteed" are the owner's claims to make, not ours). Each trade has an
 * accent colour that passes 4.5:1 with white text, for buttons.
 */
export const TRADE_COPY = {
  plumbing: {
    noun: 'plumbing',
    accent: '#1f4fbf',
    services: [
      ['Leak repair', 'Dripping pipes, running toilets and hidden leaks found and fixed.'],
      ['Drain cleaning', 'Clogged sinks, tubs, showers and main lines cleared.'],
      ['Water heaters', 'Tank and tankless water heaters repaired and replaced.'],
      ['Fixtures', 'Faucets, sinks, toilets and showers installed.'],
      ['Sewer and water lines', 'Line problems diagnosed and repaired.'],
      ['Remodel plumbing', 'Kitchen and bathroom plumbing for renovations.'],
    ],
  },
  electrical: {
    noun: 'electrical work',
    accent: '#8a4b00',
    services: [
      ['Repairs and troubleshooting', 'Dead outlets, tripping breakers and flickering lights traced and fixed.'],
      ['Panel upgrades', 'Old or overloaded panels replaced and brought up to code.'],
      ['Lighting', 'Indoor, outdoor and recessed lighting installed.'],
      ['EV chargers', 'Home car chargers installed on a dedicated circuit.'],
      ['Generators', 'Standby generators and transfer switches installed.'],
      ['Renovation wiring', 'Wiring for remodels, additions and finished basements.'],
    ],
  },
  hvac: {
    noun: 'heating and cooling',
    accent: '#0d6b73',
    services: [
      ['AC repair', 'Air conditioners that won\'t cool, won\'t start or won\'t stop.'],
      ['Heating repair', 'Furnaces, boilers and heat pumps diagnosed and repaired.'],
      ['New systems', 'Heating and cooling systems sized and installed.'],
      ['Maintenance', 'Seasonal tune-ups that keep systems running efficiently.'],
      ['Ductless mini-splits', 'Heating and cooling for rooms without ductwork.'],
      ['Indoor air quality', 'Filters, humidifiers and ventilation.'],
    ],
  },
  roofing: {
    noun: 'roofing',
    accent: '#9a2a1f',
    services: [
      ['Roof repair', 'Leaks, missing shingles and storm damage repaired.'],
      ['Roof replacement', 'Full tear-off and new roof installation.'],
      ['Inspections', 'Roof condition checked and explained, with photos.'],
      ['Gutters', 'Gutters and downspouts installed, repaired and cleaned.'],
      ['Flat roofs', 'Flat and low-slope roofing for homes and businesses.'],
      ['Skylights and flashing', 'Skylights, chimneys and vents sealed properly.'],
    ],
  },
  paving: {
    noun: 'paving and sealcoating',
    accent: '#3a3a3a',
    services: [
      ['Sealcoating', 'Asphalt protected from sun, water, salt and oil.'],
      ['Asphalt paving', 'New driveways, parking lots and pads.'],
      ['Crack filling', 'Cracks sealed before water gets into the base.'],
      ['Line striping', 'Parking lines, ADA stalls and directional markings.'],
      ['Patching and repair', 'Potholes and damaged sections cut out and repaved.'],
      ['Commercial maintenance', 'Lot maintenance for businesses and property managers.'],
    ],
  },
  remodeling: {
    noun: 'remodeling',
    accent: '#5a3f8c',
    services: [
      ['Kitchens', 'Kitchen remodels from layout to finish.'],
      ['Bathrooms', 'Bathroom remodels, showers and tile.'],
      ['Basements', 'Basements finished into living space.'],
      ['Additions', 'Room additions and layout changes.'],
      ['Flooring', 'Hardwood, tile and luxury vinyl installed.'],
      ['Repairs', 'Drywall, trim and carpentry repairs.'],
    ],
  },
  landscaping: {
    noun: 'landscaping',
    accent: '#2f6a3a',
    services: [
      ['Lawn care', 'Mowing, edging and seasonal lawn care.'],
      ['Landscape design', 'Planting beds, shrubs and trees planned and installed.'],
      ['Hardscaping', 'Patios, walkways and retaining walls.'],
      ['Cleanups', 'Spring and fall cleanups.'],
      ['Mulch and planting', 'Beds refreshed with mulch and new plants.'],
      ['Irrigation', 'Sprinkler systems installed and repaired.'],
    ],
  },
  tree: {
    noun: 'tree service',
    accent: '#3d5a1e',
    services: [
      ['Tree removal', 'Trees taken down safely, including tight spaces.'],
      ['Trimming and pruning', 'Trees shaped and thinned, dead limbs removed.'],
      ['Stump grinding', 'Stumps ground below grade.'],
      ['Storm cleanup', 'Fallen trees and limbs cleared after storms.'],
      ['Tree health', 'Trees checked for disease and risk.'],
      ['Land clearing', 'Lots cleared for building or yard space.'],
    ],
  },
}
const GENERIC = {
  noun: 'services',
  accent: '#1f4fbf',
  services: [
    ['Repairs', 'Problems diagnosed and fixed.'],
    ['Installation', 'New work installed properly.'],
    ['Estimates', 'Jobs looked at and priced.'],
  ],
}
export const copyFor = (trade) => TRADE_COPY[trade] ?? GENERIC

/**
 * Legal pages. Plain-language templates, not legal advice: Markus has them reviewed once by a
 * lawyer, and the owner confirms the facts (what the form collects, who answers it) at intake.
 */
export function privacyPolicy(b, { date, assistant }) {
  return [
    ['Who we are', `This website belongs to ${b.name}${b.areaText ? `, serving ${b.areaText}` : ''}. Questions about this policy go to ${b.contactLine}.`],
    ['What we collect', 'If you use the contact form, we receive what you type: your name, phone number, email address if you give it, and your message. That\'s all. This site has no advertising, no analytics, and sets no tracking cookies.' + (assistant ? ' If you use the chat assistant, we receive what you write in the chat.' : '')],
    ['Why', 'Only to answer you: to call or write back about the work you asked about. We don\'t use it for anything else, and we don\'t sell it or share it for advertising.'],
    ['Who handles it for us', `The site is hosted by Netlify. Form messages${assistant ? ' and chats' : ''} are delivered and stored for us by Automaton, the company that built and runs this site, under a written agreement to use them only for this purpose${assistant ? '. The chat assistant\'s replies are written by an AI service (Anthropic), which processes the conversation to answer it and does not use it to train its models' : ''}.`],
    ['How long we keep it', 'We keep messages for as long as we need them to deal with your request and for our ordinary business records, and no longer than two years unless the law requires otherwise.'],
    ['Your choices', 'You can ask us what we have about you, ask us to correct it, or ask us to delete it, using the contact details above. Some states (for example California, Colorado, Connecticut, New Jersey, Oregon, Texas and Virginia) give residents these rights by law; we honor them for everyone.'],
    ['Security', 'The site is served only over an encrypted connection (HTTPS), and messages are stored with access limited to the people who need them.'],
    ['Children', 'This site isn\'t meant for children under 13, and we don\'t knowingly collect their information.'],
    ['Changes', `If we change this policy we'll update it here. Last updated ${date}.`],
  ]
}

export function terms(b, { date }) {
  return [
    ['Using this site', `This website gives information about ${b.name} and a way to contact us. By using it you agree to these terms.`],
    ['Information on the site', 'We keep the information here accurate, but it\'s general. Prices, timing and the scope of any job are only fixed in a written estimate or agreement with you.'],
    ['No warranties', 'The site is provided as it is. We don\'t promise it will always be available or free of errors.'],
    ['Liability', 'To the extent the law allows, we aren\'t liable for losses that come from using this website. This doesn\'t limit anything we owe you under a contract for work, or rights you have by law.'],
    ['Links', 'Links to other sites (such as our Google listing) are for convenience. We aren\'t responsible for their content.'],
    ['Governing law', `These terms are governed by the laws of ${b.stateName ?? 'the state where we operate'}.`],
    ['Contact', `${b.contactLine}. Last updated ${date}.`],
  ]
}

export function accessibility(b, { date }) {
  return [
    ['Our goal', `We want everyone to be able to use this website, including people who use screen readers, keyboard navigation, magnification or voice control. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.`],
    ['What we do', 'Pages use real headings and labels, work with a keyboard, keep text readable at high zoom, use color contrast that meets AA, and don\'t rely on color alone. Every page is checked with automated accessibility tests before it goes live.'],
    ['If something doesn\'t work', `If any part of the site is hard to use, tell us at ${b.contactLine} and we'll fix it, and help you get what you need in the meantime.`],
    ['Last reviewed', date],
  ]
}

export const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'the District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' }
