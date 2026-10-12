// Original philosophical reflections for KING. Shared deterministic selection.
export const QUOTES = [
  { text: 'თავისუფლება იწყება იქ, სადაც საკუთარ შიშს აღარ ემორჩილები.', author: 'KING · ფიქრები' },
  { text: 'არჩევანი მხოლოდ მომავალს კი არა, იმასაც ცვლის, ვინც მას აკეთებს.', author: 'KING · ფიქრები' },
  { text: 'დრო არაფერს გვართმევს, რაც მხოლოდ აწმყოში არსებობს.', author: 'KING · ფიქრები' },
  { text: 'უცნობი გზა საკუთარ თავთან შეხვედრის შესაძლებლობაა.', author: 'KING · ფიქრები' },
  { text: 'სიმშვიდე პასუხების პოვნა კი არა, კითხვებთან თანაცხოვრებაა.', author: 'KING · ფიქრები' },
  { text: 'ყველაფრის კონტროლის სურვილი ხშირად საკუთარი თავის დაკარგვაა.', author: 'KING · ფიქრები' },
  { text: 'სიჩუმეში ის გვესმის, რასაც ხმაურში საკუთარ თავს ვუმალავთ.', author: 'KING · ფიქრები' },
  { text: 'მარცხი შედეგია. დანებება — არჩევანი.', author: 'KING · ფიქრები' },
  { text: 'ადამიანს ყველაზე ნათლად ის არჩევანი აჩენს, რომელსაც არავინ ხედავს.', author: 'KING · ფიქრები' },
  { text: 'რაც უფრო ღრმად ვუყურებთ სამყაროს, მით ნაკლებად ვჩქარობთ მის განსჯას.', author: 'KING · ფიქრები' },
  { text: 'მომავალი იმ მცირე გადაწყვეტილებებში იბადება, რომლებსაც დღეს ვერ ვამჩნევთ.', author: 'KING · ფიქრები' },
  { text: 'ზოგჯერ წინსვლა იმ აზრის დათმობაა, რომელიც დიდხანს გვიცავდა.', author: 'KING · ფიქრები' },
]

export function quoteForRound(roomCode = '', round = 1) {
  let seed = round * 131
  const code = String(roomCode || '')
  for (let i = 0; i < code.length; i++) {
    seed = (seed * 33 + code.charCodeAt(i)) % 1000003
  }
  return QUOTES[Math.abs(seed) % QUOTES.length]
}
