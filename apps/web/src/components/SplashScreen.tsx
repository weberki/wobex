export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Wobex splash screen">
        <img alt="Wobex" className="size-16 rounded-2xl object-cover" src="/wobex-mark.png" />
      </div>
    </div>
  );
}
