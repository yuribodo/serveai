"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

function ServeAIBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`serve-brand ${inverse ? "is-inverse" : ""}`}>
      <Image src="/serveai-logo.svg" alt="" width={28} height={28} priority />
      <span>ServeAI</span>
    </span>
  );
}

const steps = [
  ["01", "Peça", "Conte o que precisa, onde e para quando."],
  ["02", "A gente resolve", "Buscamos, contatamos e comparamos profissionais."],
  ["03", "Só aprove", "Você recebe a melhor opção pronta para agendar."],
];

export function LandingPage() {
  const landingRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const navigatingRef = useRef(false);

  const openExampleRequest = () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    const message = "Preciso de um chaveiro hoje em Pinheiros";
    const destination = `/app?prompt=${encodeURIComponent(message)}`;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(destination);
      return;
    }

    gsap.to(landingRef.current, {
      autoAlpha: 0,
      duration: 0.28,
      ease: "power2.out",
      onComplete: () => router.push(destination),
    });
  };

  useLayoutEffect(() => {
    const root = landingRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      lerp: 0.085,
      smoothWheel: true,
      wheelMultiplier: 0.9,
      anchors: true,
    });
    const updateScrollTrigger = () => ScrollTrigger.update();
    const updateLenis = (time: number) => lenis.raf(time * 1000);

    lenis.on("scroll", updateScrollTrigger);
    gsap.ticker.add(updateLenis);
    gsap.ticker.lagSmoothing(0);

    const context = gsap.context(() => {
      const heroTimeline = gsap.timeline({ defaults: { ease: "power4.out" } });

      heroTimeline
        .from(".serve-nav", { autoAlpha: 0, y: -18, duration: 0.75 })
        .from(".serve-kicker", { autoAlpha: 0, y: 14, duration: 0.65 }, "-=0.35")
        .from(".serve-title-line > span", {
          yPercent: 115,
          duration: 1.05,
          stagger: 0.1,
        }, "-=0.45")
        .from(".serve-intro", { autoAlpha: 0, y: 18, duration: 0.7 }, "-=0.48")
        .from(".serve-command", { autoAlpha: 0, y: 22, scale: 0.98, duration: 0.75 }, "-=0.46")
        .from(".serve-command-caption", { autoAlpha: 0, y: 8, duration: 0.5 }, "-=0.42")
        .from(".serve-proof span", { autoAlpha: 0, y: 10, duration: 0.55, stagger: 0.07 }, "-=0.25");

      gsap.to(".serve-hero-content", {
        yPercent: 10,
        scale: 0.97,
        autoAlpha: 0.42,
        ease: "none",
        scrollTrigger: {
          trigger: ".serve-hero",
          start: "55% 50%",
          end: "bottom top",
          scrub: 0.7,
        },
      });

      gsap.fromTo(".serve-how-surface", {
        y: 72,
        scale: 0.985,
        transformOrigin: "top center",
      }, {
        y: 0,
        scale: 1,
        ease: "none",
        scrollTrigger: {
          trigger: ".serve-how",
          start: "top 98%",
          end: "top 70%",
          scrub: 0.7,
        },
      });

      const howTimeline = gsap.timeline({
        defaults: { ease: "power4.out" },
        scrollTrigger: {
          trigger: ".serve-how",
          start: "top 72%",
          toggleActions: "play none none reverse",
        },
      });

      howTimeline
        .from(".serve-section-label", { autoAlpha: 0, y: 14, duration: 0.6 })
        .from(".serve-how-line > span", { yPercent: 115, duration: 1, stagger: 0.09 }, "-=0.3")
        .from(".serve-how-heading > p", { autoAlpha: 0, y: 20, duration: 0.7 }, "-=0.48")
        .from(".serve-step", { autoAlpha: 0, y: 38, duration: 0.8, stagger: 0.12 }, "-=0.3");

      gsap.from(".serve-final-top", {
        autoAlpha: 0,
        y: 16,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: { trigger: ".serve-final", start: "top 72%" },
      });
      gsap.from(".serve-final-line > span", {
        yPercent: 115,
        duration: 1.05,
        ease: "power4.out",
        scrollTrigger: { trigger: ".serve-final-content", start: "top 75%" },
      });
      gsap.from(".serve-final-link", {
        autoAlpha: 0,
        y: 24,
        duration: 0.75,
        ease: "power3.out",
        scrollTrigger: { trigger: ".serve-final-content", start: "top 62%" },
      });
      gsap.from(".serve-footer", {
        autoAlpha: 0,
        duration: 0.6,
        scrollTrigger: { trigger: ".serve-footer", start: "top 94%" },
      });
      gsap.fromTo(".serve-final-surface", {
        y: 64,
        scale: 0.985,
        transformOrigin: "top center",
      }, {
        y: 0,
        scale: 1,
        ease: "none",
        scrollTrigger: {
          trigger: ".serve-final",
          start: "top 98%",
          end: "top 72%",
          scrub: 0.7,
        },
      });
    }, root);

    ScrollTrigger.refresh();

    return () => {
      context.revert();
      lenis.off("scroll", updateScrollTrigger);
      lenis.destroy();
      gsap.ticker.remove(updateLenis);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, []);

  return (
    <main className="serve-landing" ref={landingRef}>
      <section className="serve-hero" aria-labelledby="serve-title">
        <nav className="serve-nav" aria-label="Navegação principal">
          <Link href="/" aria-label="ServeAI, início"><ServeAIBrand /></Link>
          <div className="serve-nav-links">
            <a href="#como-funciona">Como funciona</a>
            <Link href="/app">Entrar</Link>
          </div>
        </nav>

        <div className="serve-hero-content">
          <p className="serve-kicker">SERVIÇOS LOCAIS, RESOLVIDOS</p>
          <h1 id="serve-title">
            <span className="serve-title-line"><span>Você pede.</span></span>
            <span className="serve-title-line"><span>A ServeAI resolve.</span></span>
          </h1>
          <p className="serve-intro">
            Encontre e contrate profissionais sem pesquisar, ligar ou negociar com cada um.
          </p>

          <button className="serve-command" type="button" onClick={openExampleRequest}>
            <span>Preciso de um chaveiro hoje em Pinheiros</span>
            <span className="serve-command-action" aria-hidden="true">
              <ArrowRight size={18} />
            </span>
          </button>
          <p className="serve-command-caption">Escreva o que precisa. A ServeAI cuida do resto.</p>
        </div>

        <div className="serve-proof" aria-label="Benefícios">
          <span><Check size={13} /> Busca local</span>
          <span><Check size={13} /> Contato automático</span>
          <span><Check size={13} /> Melhor opção para você</span>
        </div>
      </section>

      <section className="serve-how" id="como-funciona" aria-labelledby="serve-how-title">
        <div className="serve-how-surface">
          <div className="serve-section-label">
            <span>Como funciona</span>
            <span>01 — 03</span>
          </div>

          <div className="serve-how-heading">
            <h2 id="serve-how-title">
              <span className="serve-how-line"><span>Diga uma vez.</span></span>
              <span className="serve-how-line"><span>A gente cuida do resto.</span></span>
            </h2>
            <p>Não é uma lista de recomendações. É um agente que executa o trabalho até existir uma opção pronta para você.</p>
          </div>

          <div className="serve-steps">
            {steps.map(([number, title, copy]) => (
              <article className="serve-step" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="serve-final" aria-labelledby="serve-final-title">
        <div className="serve-final-surface">
          <div className="serve-final-top">
            <ServeAIBrand inverse />
            <span>AGENTE DE SERVIÇOS LOCAIS</span>
          </div>

          <div className="serve-final-content">
            <h2 id="serve-final-title" className="serve-final-line"><span>Tem algo para resolver?</span></h2>
            <Link className="serve-final-link serve-pressable" href="/app">
              Começar agora <ArrowUpRight size={26} strokeWidth={1.5} />
            </Link>
          </div>

          <footer className="serve-footer">
            <span>© 2026 ServeAI</span>
            <span>São Paulo, Brasil</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
