export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-[var(--line)] px-4 pb-14 pt-10 text-[var(--sea-ink-soft)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">
          &copy; {year} commonplace Book Studio
        </p>
        <p className="island-kicker m-0">A quiet place for the stories only you can tell.</p>
      </div>
    </footer>
  )
}
