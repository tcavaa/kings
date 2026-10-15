// The "show more" button under a paged list (see hooks/usePaged).
export default function ShowMore({ remaining, onClick }) {
  if (remaining <= 0) return null
  return (
    <div className="actions center">
      <button type="button" className="link" onClick={onClick}>მეტის ნახვა ({remaining})</button>
    </div>
  )
}
