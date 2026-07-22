// Shared Premium marker. Lives on its own so the dashboard, library,
// interviews and own-material pages all label gated things identically.

export function PremiumBadge() {
  return (
    <span className="rounded-full bg-violet/12 text-violet text-[11px] font-semibold tracking-[0.06em] uppercase px-2.5 py-1">
      Premium
    </span>
  );
}

export function SectionHeading({
  children,
  premium,
}: {
  children: React.ReactNode;
  premium?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[13px] font-semibold tracking-[0.03em] uppercase text-on-surface-variant">
        {children}
        <span className="grow-line" aria-hidden="true" />
      </h2>
      {premium && <PremiumBadge />}
    </div>
  );
}
