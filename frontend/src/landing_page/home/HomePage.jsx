import { useEffect, useRef, useState } from "react";
import Hero from "./Hero";
import Awards from "./Awards";
import Stats from "./Stats";
import Pricing from "./Pricing";
import Education from "./Education";
import "./homeAnimations.css";

import OpenAccount from "../OpenAccount";

const homeIntroStorageKey = "papertrade-home-intro-seen";

function RevealSection({ children, active, delay = 0 }) {
  const sectionRef = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    const section = sectionRef.current;
    if (!section) return undefined;

    if (!("IntersectionObserver" in window)) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.unobserve(entry.target);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8%" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [active]);

  return (
    <section
      ref={sectionRef}
      className={`home-reveal ${!active || visible ? "is-visible" : ""}`}
      style={{ "--home-reveal-delay": `${delay}ms` }}
    >
      {children}
    </section>
  );
}

function HomePage() {
  const [playIntro] = useState(
    () => sessionStorage.getItem(homeIntroStorageKey) !== "1",
  );

  useEffect(() => {
    if (playIntro) sessionStorage.setItem(homeIntroStorageKey, "1");
  }, [playIntro]);

  return (
    <div className={playIntro ? "home-first-open" : ""}>
      <Hero animateIntro={playIntro} />
      <RevealSection active={playIntro}>
        <Awards />
      </RevealSection>
      <RevealSection active={playIntro} delay={60}>
        <Stats />
      </RevealSection>
      <RevealSection active={playIntro} delay={80}>
        <Pricing />
      </RevealSection>
      <RevealSection active={playIntro} delay={100}>
        <Education />
      </RevealSection>
      <RevealSection active={playIntro} delay={120}>
        <OpenAccount />
      </RevealSection>
    </div>
  );
}

export default HomePage;
