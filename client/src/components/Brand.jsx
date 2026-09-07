import a1kUrl from '../assets/a1k-logo.png';
import a1kLightUrl from '../assets/a1k-logo-light.png';

/**
 * The A1K lockup.
 *
 * Three names are in play and they are not interchangeable, so the components
 * keep them apart:
 *
 *   A1K          the platform — the logo, and the top line everywhere
 *   Task Tracker the solution you are looking at, one of several on A1K
 *   CloudMojo    the company that makes it, credited rather than displayed
 *
 * The logo ships in two cuts. The supplied artwork has near-black letters,
 * which vanish on a dark surface, so a second file recolours only the neutral
 * ink to white and leaves the gradient "1" exactly as drawn — the gradient is
 * the memorable part and inverting it would change the brand.
 */

/** The logo on its own, sized by height. Takes the theme for the same reason
 *  the lockup does: the dark-ink cut disappears on a dark rail. */
export function BrandMark({ size = 26, theme }) {
  return (
    <img
      src={theme === 'dark' ? a1kLightUrl : a1kUrl}
      alt="A1K"
      height={size}
      width={Math.round(size * 2)}
      style={{ display: 'block' }}
    />
  );
}

/**
 * Logo plus the name of this solution underneath. `product` can be turned off
 * where the name is already on the page — passing it twice is how you end up
 * reading "Task Tracker" twice in the same corner.
 */
export function BrandLockup({ theme, height = 26, product = 'Task Tracker' }) {
  return (
    <div className="lockup">
      <img
        className="brand-logo"
        src={theme === 'dark' ? a1kLightUrl : a1kUrl}
        alt="A1K"
        style={{ height }}
      />
      {product && <div className="brand-product">{product}</div>}
    </div>
  );
}

/** Who makes it. Small by design: the company signs the work, it is not the UI. */
export function CompanyLine({ prefix = 'by CloudMojo Tech' }) {
  return <div className="company-line">{prefix}</div>;
}
