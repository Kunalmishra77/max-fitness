/**
 * The first-visit preloader (ADR-061): the logo breathes on black while a red line fills,
 * then the curtain lifts after about 1.5 s.
 *
 * It is pure CSS (globals.css), so it leaves on time even if JavaScript never runs. The
 * one inline script, which runs before the first paint, hides it for the rest of the
 * session, so moving between pages never waits on it again. It is decorative:
 * hidden from assistive tech, and the page underneath is already rendered.
 */
const SEEN = `try{if(sessionStorage.getItem('mfp_preloaded')){document.documentElement.classList.add('preloaded')}else{sessionStorage.setItem('mfp_preloaded','1')}}catch(e){}`;

export function Preloader() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SEEN }} />
      <div
        aria-hidden
        className="preloader pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-obsidian"
      >
        <img src="/brand/logo-192.webp" alt="" width={198} height={192} className="preloader-logo w-36 md:w-44" />
        <div className="mt-8 h-0.5 w-40 overflow-hidden rounded-full bg-brand-paper/10">
          <div className="preloader-bar h-full bg-brand-logo-red" />
        </div>
      </div>
    </>
  );
}
