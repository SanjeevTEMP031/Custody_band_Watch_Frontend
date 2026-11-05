import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import LandingMap from './LandingMap';
import HeroMapCard from './HeroMapCard';
import './LandingPage.css';

const navItems = [
  ['Solutions', '#solutions'],
  ['Devices', '#devices'],
  ['Live GPS Map', '#live-map'],
  ['Services', '#services'],
  ['Platform & API', '#platform'],
  ['FAQ', '#faq'],
];

const capabilities = [
  {
    icon: '🛡️',
    title: 'Dual-Circuit Anti-Tamper',
    description: 'Internal conductive & optical fiber mesh. Severing or unfastening triggers emergency dispatch alarms in < 2 seconds.',
    tag: 'Hardware Core',
  },
  {
    icon: '🛰️',
    title: 'Quad-Layer Hybrid GPS',
    description: 'Seamless prioritized fallback across GPS, BeiDou, indoor Wi-Fi 5 MAC sniffing, and 4G LBS cell triangulation.',
    tag: 'Precision ±3.5m',
  },
  {
    icon: '🔋',
    title: 'Zero-Removal Wrist Charging',
    description: '830 mAh internal lithium cell + 1,200 mAh quick-snap mobile charging dock. Charge on-the-wrist without breaking custody.',
    tag: '96h Standby',
  },
  {
    icon: '❤️',
    title: 'Continuous Biometrics',
    description: 'Medical-grade optical PPG heart rate, core body temperature, SpO2 blood oxygen, fall detection, and 808s sleep analysis.',
    tag: 'Vital Telemetry',
  },
  {
    icon: '📞',
    title: 'Two-Way Voice Whitelist',
    description: 'Up to 15 authorized numbers (PHL), silent ambient audio monitoring (CALL), and Unicode UTF-16 push text messaging.',
    tag: '4G LTE Comms',
  },
  {
    icon: '⚖️',
    title: 'Court-Admissible Evidence',
    description: 'Unalterable forensic trajectory reports, digital SHA-256 fingerprinting, and automated PDF/CSV compliance exports.',
    tag: 'Judicial Certified',
  },
];

const services = [
  {
    title: 'Judicial Parole & Probation',
    badge: 'CORRECTIONS',
    desc: 'Cost-effective community-based alternative to incarceration. Enforces curfews, dwell zones, and authorized workplace corridors with automated breach logs.',
    points: ['Real-time inclusion perimeter enforcement', 'Automated violation escalation logs', 'Direct officer two-way voice check-in']
  },
  {
    title: 'Pre-Trial Bail & House Arrest',
    badge: 'LAW ENFORCEMENT',
    desc: 'Mitigates flight risk and prevents victim harassment. Enforces stay-away exclusion zones around airports, borders, and victim residences.',
    points: ['Immediate CR on-demand GPS polling', 'Exclusion zone breach alarms in < 2s', 'Tamper-evident mechanical locking clasp']
  },
  {
    title: 'Dementia & Alzheimer\'s Protection',
    badge: 'HEALTHCARE',
    desc: 'Non-removable wristband designed for memory care facilities and vulnerable wanderers. Prevents patients from removing their tracking bracelet.',
    points: ['Snap-on charger avoids patient agitation', 'Core temperature & violent fall impact alerts', 'Wandering exit sirens to nursing stations']
  },
  {
    title: 'Secure Transit & Hospital Escorts',
    badge: 'SECURITY ESCORT',
    desc: 'Engineered for high-risk prisoners undergoing treatment at public medical facilities, inter-prison transfers, or judicial courtroom appearances.',
    points: ['Cut-strap alarm with sound siren on dispatch', 'Multi-carrier 4G LTE cellular coverage', 'Encrypted CAD emergency webhook broadcast']
  }
];

const steps = [
  ['01', 'Install & Lock', 'Bracelet is fitted on wearer wrist and secured with tamper-evident micro-screws and conductive loop clasp.'],
  ['02', 'Multi-Layer Fix', 'Watch acquires high-precision coordinates using GPS, BeiDou, indoor Wi-Fi sniffing, or 4G LTE cell towers.'],
  ['03', 'Cellular Stream', 'Telemetry streams securely to cloud socket gateway with end-to-end encrypted protocol v2.1.'],
  ['04', 'Cloud Dispatch', 'FastAPI backend processes GPS coordinates, biometrics, and verifies inclusion/exclusion geofence rules.'],
  ['05', 'Judicial Action', 'Supervising officers review live alerts, dispatch field teams, or generate court-admissible audit packets.'],
];

type IconName = 'arrow' | 'pin' | 'shield' | 'menu' | 'close' | 'check' | 'play' | 'external' | 'refresh';

function Icon({ name, size = 20, className = '' }: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m9 12 2 2 4-4" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    external: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
    refresh: <><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" /></>
  };
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">{paths[name]}</svg>
  );
}

function Brand({ light = false }) {
  return (
    <a className={`brand${light ? ' brand-light' : ''}`} href="#home" aria-label="Trackin360 home">
      <span className="brand-mark"><span /><span /><span /></span>
      <span>trackin<span className="brand-blue">360</span></span>
      <span className="brand-badge-c05">C05 ECOSYSTEM</span>
    </a>
  );
}

function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [liveStats, setLiveStats] = useState({
    total_devices: 2450,
    online_devices: 2448,
    battery: 92,
    heartRate: 72,
    steps: 4120,
    wearer: 'Assigned Subject (Case #CASE-C05-01)',
    lat: 47.6097,
    lon: -122.3331
  });

  useEffect(() => {
    fetch('/api/v1/devices')
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : (data.value || []);
        if (list.length > 0) {
          const d = list[0];
          setLiveStats({
            total_devices: list.length,
            online_devices: list.filter((x: any) => x.connection_status === 'online').length || 1,
            battery: d.battery_percent ?? 63,
            heartRate: d.heart_rate_bpm ?? 81,
            steps: d.steps ?? 1834,
            wearer: d.wearer_name ? `${d.wearer_name} (Case #${d.case_number || 'CASE-C05-01'})` : 'Assigned Subject (Case #CASE-C05-01)',
            lat: 47.6097,
            lon: -122.3331
          });
        }
      })
      .catch(() => { });
  }, []);


  return (
    <div className="landing-page">
      <a className="skip-link" href="#main">Skip to content</a>

      {/* Top Strategic Navigation Header */}
      <header className="site-header">
        <div className="nav-wrap">
          <Brand />

          <button className="mobile-menu" type="button" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>

          <nav className={`main-nav${menuOpen ? ' nav-open' : ''}`} aria-label="Main navigation">
            {navItems.map(([label, href]) => (
              <a key={label} href={href} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}



            <a className="nav-cta" href="#solutions" onClick={() => setMenuOpen(false)}>
              Explore Solutions <Icon name="arrow" size={15} />
            </a>
            <Link className="nav-login-btn" to="/admin/login" onClick={() => setMenuOpen(false)}>
              Officer Login
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero Section */}
        <section className="hero" id="home">
          <div className="hero-glow" />
          <div className="container hero-layout">
            <div className="hero-copy">
              <div className="eyebrow eyebrow-light">
                <span className="eyebrow-line" /> CERTIFIED 4G LTE IoT  &amp; CUSTODY SUPERVISION
              </div>

              <h1>Continuous Custody.<br /><span>Zero Tampering.</span></h1>

              <p className="hero-description">
                The enterprise standard in electronic offender monitoring and secure parole enforcement.
                Powered by the <strong>Trackin360 C05 4G Non-Removable GPS Tracking Bracelet</strong> with
                dual-circuit optical cut detection, quad-layer hybrid positioning, and continuous biometric vital signs.
              </p>


            </div>

            {/* Tactical Watch Visual Stage */}
            <div className="hero-visual">
              <div className="hero-visual-orb" />

              <HeroMapCard
                lat={liveStats.lat}
                lon={liveStats.lon}
                wearer={liveStats.wearer}
                caseNumber="CASE-2026-EM01"
                deviceId="863758******420"
                battery={liveStats.battery}
                heartRate={liveStats.heartRate}
                steps={liveStats.steps}
                isOnline={true}
              />


            </div>
          </div>

          <div className="hero-bottom container">
            <span>OFFICIAL TRACKIN360 C05 HARDWARE INTEGRATION</span>
            <div>
              <i></i> Quad GPS+BDS+WiFi+LBS
              <i></i> MNYD Protocol v2.1
              <i></i> AES-256 Encrypted
              <i></i> Court Certified
            </div>
          </div>
        </section>

        {/* Live Telemetry KPI Ticker Strip */}
        <section className="kpi-ticker-section">
          <div className="container kpi-ticker-grid">
            <div className="kpi-cell">
              <span className="kpi-num">2,450+</span>
              <span className="kpi-meta">SUPERVISED BANDS ACTIVE</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-num">&lt; 2.0s</span>
              <span className="kpi-meta">INSTANT CUT ALERT TRANSMISSION</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-num">IP68</span>
              <span className="kpi-meta">SUBMERSIBLE WATERPROOF RATING</span>
            </div>
            <div className="kpi-cell">
              <span className="kpi-num">99.99%</span>
              <span className="kpi-meta">ENTERPRISE CLOUD UPTIME SLA</span>
            </div>
          </div>
        </section>

        {/* Interactive OpenStreetMap Section */}
        <section className="section live-map-section" id="live-map">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> OPENSTREETMAP LEAFLET INTEGRATION</div>
                <h2>Interactive Real-Time<br />GPS Tracking Map.</h2>
              </div>
              <p className="section-subtitle-text">
                Enterprise OpenStreetMap Leaflet integration with multi-constellation satellite telemetry, dynamic inclusion perimeters, and active vital signs monitoring.
              </p>
            </div>

            {/* Embedded Leaflet Map Component */}
            <LandingMap />
          </div>
        </section>

        {/* Capabilities Section */}
        <section className="section capabilities-section" id="solutions">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> PATIENT &amp; OFFENDER ACCOUNTABILITY</div>
                <h2>Core Architectural<br />Capabilities.</h2>
              </div>
              <p className="section-subtitle-text">
                Designed to eliminate evasion vulnerabilities, false positives, and equipment downtime in high-risk environments.
              </p>
            </div>

            <div className="capabilities-grid">
              {capabilities.map((c) => (
                <div key={c.title} className="cap-card">
                  <div className="cap-icon-box">{c.icon}</div>
                  <div className="cap-badge mono">{c.tag}</div>
                  <h3 className="cap-title">{c.title}</h3>
                  <p className="cap-desc">{c.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* C05 Hardware Architecture Section */}
        <section className="section hardware-section" id="devices">
          <div className="container hardware-layout">
            <div className="hardware-info-col">
              <div className="eyebrow"><span className="eyebrow-line" /> TRACKIN360 HARDWARE PROFILE</div>
              <h2>Trackin360 C05 4G Tamper-Proof<br />Tracking Bracelet.</h2>
              <p>
                Engineered by Trackin360 specifically for criminal justice parole,
                court-ordered electronic monitoring, dementia wandering safeguards, and hospital prisoner transfers.
              </p>

              <div className="hw-specs-grid">
                <div className="hw-spec-item">
                  <strong>Dual Battery Architecture</strong>
                  <span>830 mAh internal + 1,200 mAh snap-on mobile power bank (charge on wrist 24/7)</span>
                </div>
                <div className="hw-spec-item">
                  <strong>Quad Positioning Modes</strong>
                  <span>GPS + BeiDou + GLONASS + 5-BSSID Wi-Fi Sniffing + 4G LTE Cell Triangulation</span>
                </div>
                <div className="hw-spec-item">
                  <strong>Tamper Detection Hardware</strong>
                  <span>Dual mechanical screws + internal conductive &amp; optical fiber continuity loop</span>
                </div>
                <div className="hw-spec-item">
                  <strong>Two-Way Voice &amp; Messaging</strong>
                  <span>Built-in speaker/mic, 10–15 whitelist numbers (PHL), silent monitor (CALL), Unicode SMS</span>
                </div>
              </div>


            </div>

            <div className="hardware-visual-col">
              <div className="hw-diagram-card">
                <div className="diagram-header">
                  <span className="mono text-xs">C05 PHYSICAL INTERFACE (V2.0)</span>
                  <span className="badge-ip68">IP68 WATERPROOF</span>
                </div>

                <div className="diagram-body">
                  <div className="spec-callout callout-screen">
                    <span className="callout-point"></span>
                    <div>
                      <b>1.4" Color Touch Display</b>
                      <small>Shows battery, 4G LTE, BLE, and tamper lock status</small>
                    </div>
                  </div>

                  <div className="spec-callout callout-screws">
                    <span className="callout-point"></span>
                    <div>
                      <b>Tamper-Evident Micro-Screws</b>
                      <small>Requires proprietary torque key for installation &amp; release</small>
                    </div>
                  </div>

                  <div className="spec-callout callout-dock">
                    <span className="callout-point"></span>
                    <div>
                      <b>1,200 mAh Magnetic Power Bank</b>
                      <small>Clips onto wristband for uninterrupted continuous tracking</small>
                    </div>
                  </div>

                  <div className="spec-callout callout-sensor">
                    <span className="callout-point"></span>
                    <div>
                      <b>PPG Biometric &amp; Temp Sensor</b>
                      <small>Verifies live human contact &amp; detects violent impacts/falls</small>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Operational Services Section */}
        <section className="section services-section" id="services">
          <div className="container">
            <div className="section-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> PURPOSE-BUILT DEPLOYMENT SECTORS</div>
                <h2>Mission-Critical Services<br />&amp; Use Cases.</h2>
              </div>
              <p className="section-subtitle-text">
                Deployed across correctional departments, sheriff offices, state rehabilitation agencies, and geriatric healthcare networks.
              </p>
            </div>

            <div className="services-grid">
              {services.map((s) => (
                <div key={s.title} className="service-card">
                  <div className="service-top">
                    <span className="service-badge mono">{s.badge}</span>
                  </div>
                  <h3 className="service-title">{s.title}</h3>
                  <p className="service-desc">{s.desc}</p>
                  <ul className="service-points">
                    {s.points.map((pt, i) => (
                      <li key={i}><Icon name="check" size={14} /> {pt}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow Section */}
        <section className="workflow-section" id="how-it-works">
          <div className="container">
            <div className="workflow-heading">
              <div className="eyebrow"><span className="eyebrow-line" /> PROTOCOL &amp; DISPATCH LIFECYCLE</div>
              <h2>From Physical Strap<br />to Judicial Decision.</h2>
              <p>How the Trackin360 C05 bracelet integrates seamlessly with cloud dispatch and supervisory field officers.</p>
            </div>

            <div className="steps-track">
              {steps.map(([number, title, text], index) => (
                <article className="step" key={number}>
                  <div className="step-marker">
                    <span>{number}</span>
                    {index < steps.length - 1 && <i />}
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Platform & API Architecture */}
        <section className="section platform-section" id="platform">
          <div className="container platform-layout">
            <div className="platform-info">
              <div className="eyebrow"><span className="eyebrow-line" /> ENTERPRISE BACKEND ARCHITECTURE</div>
              <h2>High-Throughput FastAPI &amp;<br />Raw Socket Gateway.</h2>
              <p>
                Directly connects with law enforcement dispatch CAD systems, court databases, and agency records
                via high-performance asynchronous REST endpoints and Google Firebase cloud synchronization.
              </p>

              <div className="api-highlights-list">
                <div className="api-highlight-item">
                  <strong>REST API Service:</strong>
                  <code>https://api.trackin360.com/v1/</code>
                </div>
                <div className="api-highlight-item">
                  <strong>Cellular Hardware Receiver:</strong>
                  <code>Encrypted Cellular Ingestion Gateway (Secure TLS)</code>
                </div>
                <div className="api-highlight-item">
                  <strong>Supported Protocol Commands:</strong>
                  <code>Real-Time Polling, Dynamic Intervals, Remote Diagnostics, Geofence Sync</code>
                </div>
              </div>


            </div>

            <div className="platform-terminal">
              <div className="terminal-header">
                <span className="dot red"></span>
                <span className="dot yellow"></span>
                <span className="dot green"></span>
                <span className="mono text-xs">TELEMETRY INGESTION DISPATCHER</span>
              </div>
              <div className="terminal-content mono">
                <div className="text-muted">// Active raw telemetry packet stream:</div>
                <div className="text-cyan">[TRK360*UNIT-084*PING] &rarr; ACK</div>
                <div className="text-emerald">[TRK360*UNIT-084*LOCATION: SECURE / LOCKED]</div>
                <div className="text-white">&gt; Ingestion Status: ACTIVE (Encrypted TLS)</div>
                <div className="text-emerald">&gt; Biometric Telemetry: NORMAL (72 BPM | 36.6°C)</div>
                <div className="text-cyan">&gt; Firebase Sync: COMPLIANT</div>
              </div>
            </div>
          </div>
        </section>

        {/* Frequently Asked Questions */}
        <section className="section faq-section" id="faq">
          <div className="container faq-layout">
            <div className="faq-intro">
              <div className="eyebrow"><span className="eyebrow-line" /> ANSWERS FOR SUPERVISING AGENCIES</div>
              <h2>Frequently Asked<br />Questions.</h2>
              <p>Technical and legal answers regarding device deployment, battery management, and anti-tamper mechanics.</p>
              <Link className="text-link" to="/admin/login">Access Officer Portal &rarr;</Link>
            </div>

            <div className="faq-list">
              <details>
                <summary>How does the C05 watch prevent wearers from removing it? <span>+</span></summary>
                <p>The C05 bracelet uses a dual-circuit security system: high-tensile silicone strap embedded with conductive and optical continuity tracing, locked by mechanical tamper-evident screws. Severing or unfastening transmits an alert to dispatch in &lt; 2 seconds.</p>
              </details>

              <details>
                <summary>How is the watch charged without removing it from the wrist? <span>+</span></summary>
                <p>The system includes a 1,200 mAh snap-on mobile power bank dock that clips directly onto the watch on the wearer's wrist. The wearer can walk and sleep freely during charging without violating custody.</p>
              </details>

              <details>
                <summary>What positioning technology is used indoors where GPS is unavailable? <span>+</span></summary>
                <p>The C05 watch automatically falls back to Wi-Fi BSSID sniffing (capturing up to 5 nearby Wi-Fi MAC addresses) and LBS multi-cell triangulation, locating wearers inside shopping malls, tunnels, and residential complexes.</p>
              </details>

              <details>
                <summary>Are tracking logs admissible in court hearings? <span>+</span></summary>
                <p>Yes. The platform generates court-admissible forensic evidence packets with unalterable timestamps, GPS coordinate breadcrumbs, officer audit ledgers, and digital SHA-256 fingerprinting.</p>
              </details>
            </div>
          </div>
        </section>



      </main>

      {/* Enterprise Footer */}
      <footer className="site-footer">
        <div className="container">
          <div className="footer-main">
            <div className="footer-brand">
              <Brand light />
              <p>
                Continuous electronic custody monitoring &amp; judicial supervision platforms.
                Integrating the Trackin360 C05 4G Tamper-Proof Smartwatch with enterprise cloud dispatch.
              </p>
              <span className="footer-disclaimer">
                Complies with judicial chain-of-custody and high-security corrections standards.
              </span>
            </div>

            <div className="footer-column">
              <b>Navigation</b>
              <a href="#solutions">Solutions</a>
              <a href="#devices">C05 Hardware Specs</a>
              <a href="#live-map">Interactive Map</a>
              <a href="#services">Services</a>
              <a href="#platform">Platform Architecture</a>
            </div>

            <div className="footer-column">
              <b>Platform &amp; System</b>
              <a href="#platform">Architecture</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#faq">Technical FAQ</a>
            </div>

            <div className="footer-column">
              <b>Deployment</b>
              <p>Trackin360 Electronic Monitoring Systems</p>
              <p className="footer-disclaimer">Global Hardware OEM & ODM Solutions.</p>
            </div>
          </div>

          <div className="footer-bottom">
            <span>&copy; {new Date().getFullYear()} Trackin360 Electronic Monitoring Solutions. All rights reserved.</span>
            <span>MNYD Protocol v2.1 &bull; IP68 Submersible &bull; AES-256 Encrypted</span>
            <span className="footer-concept">Production Enterprise Release</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
