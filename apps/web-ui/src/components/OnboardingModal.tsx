import { useEffect, useState } from 'react';
import { X, Sparkles, GitBranch, FileText, ShieldCheck, ArrowRight, Boxes } from 'lucide-react';

const STORAGE_KEY = 'ahg-onboarding-dismissed-v1';

interface OnboardingModalProps {
  /** Programmatic open (e.g. from a Help button). When undefined, modal
   *  decides based on localStorage. */
  forceOpen?: boolean;
  onClose?: () => void;
}

const STEPS = [
  {
    icon: Boxes,
    title: 'Welcome to Agent Harness Studio',
    blurb:
      'Scaffold a focused, branded AI agent harness in your browser. 100% client-side — nothing leaves this page. Output is byte-compatible with the `npx create-agent-harness` CLI.',
    bullets: [
      '4 tabs across the top match 4 starting points',
      'Pick whichever matches what you have today',
      'Download a `.zip` at the end — unzip + `npm install` + run',
    ],
  },
  {
    icon: GitBranch,
    title: 'Tab 1 — Repo → Harness',
    blurb: 'You already have a GitHub repo and want a harness shaped to it.',
    bullets: [
      'Paste a public GitHub URL',
      'Deterministic file inventory → archetype scoring → editable plan',
      'Lexical scoring by default; toggle MiniLM (Transformers.js) for semantic boost',
      'No repo code is ever executed',
    ],
  },
  {
    icon: Sparkles,
    title: 'Tab 2 — Create harness',
    blurb:
      'Blank slate. Pick a name, a vertical, the hosts you target, the agents and skills you want, the MCP mode, and your security primitives.',
    bullets: [
      '19 quick-start verticals (coding, trading, education, gaming, …)',
      '6 supported hosts (Claude Code, OpenAI Codex, pi.dev, Hermes, OpenClaw, RVM)',
      'Live file tree preview as you edit',
      'Download `.zip` — byte-identical to the CLI scaffold',
    ],
  },
  {
    icon: FileText,
    title: 'Tab 3 — Skill / Agent / Command',
    blurb:
      'You don\'t want a whole harness — just a single SKILL.md folder you can drop into Claude desktop or claude.ai.',
    bullets: [
      'Pick or author a single artifact',
      'Generated as a Claude-ready `SKILL.md` folder with YAML frontmatter',
      'Drag-drop into Claude → done',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Tab 4 — Verify',
    blurb:
      'You downloaded a `.zip` (yours or someone else\'s) and want to sanity-check it before unzipping.',
    bullets: [
      'Drag a `.zip` onto the page',
      'Checks structure, kernel version, MCP policy, leaked secrets',
      'Result reported in-browser; nothing uploaded',
    ],
  },
];

export function OnboardingModal({ forceOpen, onClose }: OnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen === true) {
      setOpen(true);
      setStep(0);
      return;
    }
    if (forceOpen === false) {
      setOpen(false);
      return;
    }
    // forceOpen undefined → decide from localStorage
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY) === '1';
      if (!dismissed) {
        setOpen(true);
      }
    } catch {
      // localStorage may throw in private modes — silently skip
    }
  }, [forceOpen]);

  function dismiss(remember: boolean) {
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    setStep(0);
    onClose?.();
  }

  if (!open) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(false);
      }}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl sm:p-7">
        <button
          aria-label="Close onboarding"
          onClick={() => dismiss(false)}
          className="absolute right-3 top-3 rounded-md p-1.5 text-slate-500 transition hover:bg-ink-800 hover:text-white"
        >
          <X size={16} />
        </button>

        <div className="mb-3 flex items-center gap-2.5">
          <div className="rounded-lg border border-brand/40 bg-brand/10 p-1.5 text-brand-glow">
            <Icon size={18} />
          </div>
          <h2 id="onboarding-title" className="text-base font-semibold text-white sm:text-lg">
            {current.title}
          </h2>
        </div>

        <p className="mb-3 text-sm text-slate-300 sm:text-[15px]">{current.blurb}</p>

        <ul className="mb-5 space-y-1.5 text-sm text-slate-400">
          {current.bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-glow" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {/* Progress dots */}
        <div className="mb-4 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to step ${i + 1}`}
              onClick={() => setStep(i)}
              className={
                'h-1.5 rounded-full transition ' +
                (i === step
                  ? 'w-6 bg-brand-glow'
                  : 'w-1.5 bg-ink-700 hover:bg-ink-600')
              }
            />
          ))}
        </div>

        <div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            {!isLast && (
              <button
                onClick={() => dismiss(true)}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-ink-800 hover:text-white"
              >
                Skip
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-slate-200 transition hover:border-ink-600 hover:text-white"
              >
                Back
              </button>
            )}
            {!isLast && (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-glow sm:px-4"
              >
                Next <ArrowRight size={14} />
              </button>
            )}
            {isLast && (
              <button
                onClick={() => dismiss(true)}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white transition hover:bg-brand-glow"
              >
                Get started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Helper to programmatically reopen the onboarding (e.g. from a Help button). */
export function clearOnboardingDismissal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
