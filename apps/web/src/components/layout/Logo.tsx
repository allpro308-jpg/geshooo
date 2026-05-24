type LogoProps = {
  compact?: boolean;
};

export function Logo({ compact = false }: LogoProps) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-tighter2 text-ink">
          singulary
        </span>
      ) : null}
    </div>
  );
}

export function LogoMark() {
  return (
    <img
      src="/icon.png"
      alt="Singulary"
      className="h-7 w-7 rounded-md shadow-sm shadow-pink-500/20"
      draggable={false}
    />
  );
}
