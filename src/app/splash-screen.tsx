import nestraLogo from '../assets/logo.png';
import nestraWordmark from '../assets/nestra-wordmark.png';

interface SplashScreenProps {
  readonly exiting: boolean;
}

export function SplashScreen({ exiting }: SplashScreenProps) {
  return (
    <div
      className={['splash-screen', exiting ? 'splash-screen--exiting' : '']
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-label="Nestra iniciando"
    >
      <div className="splash-screen__content">
        <img
          className="splash-screen__logo"
          src={nestraLogo}
          alt=""
          aria-hidden="true"
        />

        <img
          className="splash-screen__wordmark"
          src={nestraWordmark}
          alt=""
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
