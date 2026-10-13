// The four suits as the King Online UI writes them. Colours stay with each
// surface (cards, icons, the canvas), since those differ on purpose.
export const SUIT_SYMBOLS = { H: '♥', D: '♦', S: '♠', C: '♣' }
export const SUIT_NAMES = { H: 'გული', D: 'აგური', S: 'ყვავი', C: 'ჯვარი' }
export const isRedSuit = (suit) => suit === 'H' || suit === 'D'
