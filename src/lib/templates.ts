// Built-in starter templates, one per domain. The metadata drives the gallery
// UI; the actual page (and any embedded preset tables) is built by the
// `createTemplatePage` store action, which can reach the table/page APIs.

export interface TemplateDef {
  key: string;
  title: string;
  icon: string;
  blurb: string;
}

export const TEMPLATES: TemplateDef[] = [
  { key: 'trip', title: 'New trip', icon: '✈️', blurb: 'Itinerary, budget and a packing list, ready to fill.' },
  { key: 'sprint', title: 'New sprint', icon: '🎯', blurb: 'A board, the goal, and what done means.' },
  { key: 'dnd', title: 'D&D session', icon: '🐉', blurb: 'Initiative tracker, scene notes and a recap.' },
  { key: 'weekly', title: 'Weekly review', icon: '🗓️', blurb: 'Reflect, plan and reset for the week ahead.' },
];
