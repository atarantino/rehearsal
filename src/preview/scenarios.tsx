// Design-preview fixtures. Types come from the real Convex functions, so
// `npm run build` fails here when a query's return shape changes.
import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PLANS } from "../../shared/plans";
import { Billing } from "../Billing";
import { Preparation } from "../Preparation";
import {
  OpportunityResume,
  PracticeResume,
  ResumeEditor,
} from "../Resume";
import { handle, LOADING, PENDING, type Handlers } from "./convex-react";

type BillingSummary = FunctionReturnType<typeof api.billing.summary>;
type UsageSummary = FunctionReturnType<typeof api.usage.summary>;
type Opportunity = NonNullable<FunctionReturnType<typeof api.preparation.get>>;
type Inbox = FunctionReturnType<typeof api.email.inbox>;
type ResumeView = FunctionReturnType<typeof api.resumes.get>;

export type Scenario = {
  id: string;
  group: "Billing" | "Preparation" | "Resume";
  title: string;
  /** Query string the component reads on mount, e.g. a Stripe return. */
  search?: string;
  /** Render inside a setup panel, as the app does for practice-time pieces. */
  panel?: boolean;
  handlers: Handlers;
  render: () => ReactNode;
};

const DAY = 86_400_000;
const periodEnd = Date.UTC(2026, 9, 27);
const log = (label: string) => (value: unknown) =>
  console.info(`[preview] ${label}`, value);

// ---------- Billing ----------
function billing(
  plan: Partial<BillingSummary>,
  usage: Partial<UsageSummary>,
  extra: [string, (args: any) => unknown][] = [],
): Handlers {
  const summary: BillingSummary = {
    plan: "free",
    status: "none",
    configured: true,
    testMode: true,
    cancelAtPeriodEnd: false,
    periodEnd: null,
    ...plan,
  };
  const allowance: UsageSummary = {
    voiceMinutesUsed: 2,
    voiceMinutesReserved: 0,
    voiceMinutesLimit: PLANS.free.voiceMinutes,
    preparationsUsed: 1,
    preparationsLimit: PLANS.free.preparations,
    periodEnd,
    ...usage,
  };
  return Object.fromEntries([
    handle(api.billing.summary, () => summary),
    handle(api.usage.summary, () => allowance),
    handle(api.billing.checkout, () => PENDING),
    handle(api.billing.portal, () => PENDING),
    handle(api.billing.refresh, () => null),
    ...extra,
  ]);
}
const plus = { plan: "plus", status: "active", periodEnd } as const;
const plusUsage = {
  voiceMinutesLimit: PLANS.plus.voiceMinutes,
  preparationsLimit: PLANS.plus.preparations,
};

// ---------- Preparation ----------
const oppId = (n: number) => `preview-opportunity-${n}` as Id<"opportunities">;
const base = {
  _creationTime: Date.now() - 2 * DAY,
  ownerId: "preview-user" as Id<"users">,
  requestId: "preview",
  receivedAt: Date.now() - 2 * DAY,
};

const designerBrief: NonNullable<Opportunity["brief"]> = {
  company: "Northwind Health",
  role: "Senior Product Designer, Patient Scheduling",
  interviewDate: "October 9",
  preparation: [],
  summary:
    "Northwind Health is rebuilding how patients book and reschedule visits across 40 clinics. This role owns the scheduling flow end to end, partnering with one product manager and four engineers, and is expected to raise the bar on accessibility.",
  focusAreas: [
    {
      topic: "Designing for high-stakes, low-frequency tasks",
      why: "The posting stresses patients who book rarely and under stress. Expect questions about reducing errors, not adding features.",
      sourceUrl:
        "https://careers.northwind.example/jobs/senior-product-designer",
    },
    {
      topic: "Accessibility as a shipping requirement",
      why: "Their design principles page commits to WCAG 2.2 AA for every release. Have a concrete example of fixing an accessibility gap.",
      sourceUrl: "https://design.northwind.example/principles",
    },
    {
      topic: "Working across clinics with different workflows",
      why: "Recent engineering blog posts describe per-clinic configuration. They may ask how you balance consistency with local needs.",
      sourceUrl: "https://northwind.example/blog/one-scheduler-forty-clinics",
    },
  ],
  questions: [
    "Tell me about a time you simplified a flow that people used under stress.",
    "How do you decide when a design is accessible enough to ship?",
    "Describe a disagreement with engineering about scope. How was it resolved?",
    "Walk me through how you would research why patients abandon rescheduling.",
  ],
  uncertainties: [
    "The posting does not say whether the role is remote, hybrid, or on site.",
    "Team size is inferred from a 2025 blog post and may have changed.",
  ],
};
const designer: Opportunity = {
  ...base,
  _id: oppId(1),
  input: "https://careers.northwind.example/jobs/senior-product-designer",
  kind: "url",
  status: "ready",
  resumeMode: "default",
  brief: designerBrief,
  sources: [
    {
      url: "https://careers.northwind.example/jobs/senior-product-designer",
      title: "Senior Product Designer, Patient Scheduling — Northwind Careers",
      text: "",
    },
    {
      url: "https://design.northwind.example/principles",
      title: "Design principles — Northwind Health",
      text: "",
    },
    {
      url: "https://northwind.example/blog/one-scheduler-forty-clinics",
      title: "One scheduler, forty clinics",
      text: "",
    },
  ],
};

const engineer: Opportunity = {
  ...base,
  _id: oppId(2),
  input: "Forwarded invitation",
  kind: "email",
  status: "ready",
  resumeMode: "custom",
  resumeText: "Jordan Lee — Payments engineer (tailored)\n…",
  brief: {
    company: "Brightline Transit",
    role: "Staff Software Engineer, Payments",
    interviewDate: "October 14 at 10:00",
    preparation: [
      "Panel with the payments engineering lead and a product manager.",
      "45 minutes on video; camera on.",
      "Bring an example of a system you migrated without downtime.",
    ],
    summary:
      "Brightline Transit is moving fare payments from a legacy processor to a new platform ahead of a regional fare change. The panel will focus on migrations, reliability, and how you lead without authority.",
    focusAreas: [
      {
        topic: "Zero-downtime migrations",
        why: "The invitation asks you to bring one. Prepare the rollback plan, not just the happy path.",
        sourceUrl: "#attachment-agenda",
      },
      {
        topic: "Leading without authority",
        why: "A Staff role here spans three teams, according to the team overview.",
        sourceUrl: "#attachment-team",
      },
    ],
    questions: [
      "Tell me about a migration you led. What would you do differently?",
      "How do you get three teams to agree on an interface?",
    ],
    uncertainties: [],
  },
  sources: [
    { url: "#attachment-agenda", title: "Interview agenda.pdf", text: "" },
    { url: "#attachment-team", title: "Team overview.docx", text: "" },
  ],
  attachments: [
    {
      id: "agenda",
      filename: "Interview agenda.pdf",
      contentType: "application/pdf",
      size: 182_000,
      status: "imported",
    },
    {
      id: "team",
      filename: "Team overview.docx",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 64_000,
      status: "imported",
    },
    {
      id: "map",
      filename: "Office map.png",
      contentType: "image/png",
      size: 900_000,
      status: "skipped",
      note: "Images need a text-based copy.",
    },
    {
      id: "process",
      filename: "Hiring process.pdf",
      contentType: "application/pdf",
      size: 240_000,
      status: "failed",
      note: "This PDF is password-protected.",
    },
  ],
  omittedAttachmentCount: 2,
};

const researching: Opportunity = {
  ...base,
  _id: oppId(3),
  input: "https://jobs.lumen.example/roles/4417-product-manager",
  kind: "url",
  status: "researching",
  sources: [],
};

const readingEmail: Opportunity = {
  ...base,
  _id: oppId(4),
  input: "Forwarded invitation",
  kind: "email",
  status: "reading",
  sources: [],
  attachments: [
    {
      id: "jd",
      filename: "Job description.pdf",
      contentType: "application/pdf",
      size: 120_000,
      status: "pending",
    },
  ],
};

const failed: Opportunity = {
  ...base,
  _id: oppId(5),
  input: "https://intranet.acme.example/jobs/2231",
  kind: "url",
  status: "failed",
  sources: [],
  error:
    "We could not read that page. It may need a sign-in. Try a public link to the posting, or forward the invitation instead.",
};

// Same job board host as `failed`, so the picker must still tell them apart.
const failedSameHost: Opportunity = {
  ...failed,
  _id: oppId(6),
  input:
    "https://intranet.acme.example/careers/engineering/platform/jobs/2240?source=referral",
};

const defaultResumeText =
  "Jordan Lee\nProduct designer · 9 years\n\nLead Product Designer, Fieldnote (2021–present)\n- Redesigned appointment booking; cut abandoned bookings by a third.\n…";

function preparation(
  opportunities: Opportunity[] | typeof LOADING,
  inbox: Inbox | typeof LOADING = null,
  defaultText = defaultResumeText,
): Handlers {
  const find = (id: Id<"opportunities">) =>
    opportunities === LOADING
      ? null
      : (opportunities.find((o) => o._id === id) ?? null);
  return Object.fromEntries([
    handle(api.preparation.list, () =>
      opportunities === LOADING
        ? LOADING
        : opportunities.map(({ sources, attachments, ...o }) => ({
            ...o,
            sources: sources.map(({ url, title }) => ({ url, title })),
            attachments: attachments?.map(({ text: _text, ...a }) => a),
          })),
    ),
    handle(api.preparation.get, ({ id }) => find(id)),
    handle(api.email.inbox, () => inbox),
    handle(api.resumes.get, ({ opportunityId }) => {
      const o = opportunityId ? find(opportunityId) : null;
      return {
        defaultText,
        mode: o?.resumeMode ?? "default",
        customText: o?.resumeText ?? "",
        opportunityLabel: o?.brief
          ? [o.brief.role, o.brief.company].filter(Boolean).join(" · ")
          : "",
      };
    }),
  ]);
}
const prep = () => (
  <Preparation
    onSelect={log("onSelect")}
    onReady={log("onReady")}
    onOpportunityChange={() => log("onOpportunityChange")(null)}
  />
);
const sharedInbox: Inbox = {
  address: "prepare@inbox.rehearsal.example",
  autoReply: true,
  subjectMarker: "[rh-7Q2K-M9XD]",
};

// ---------- Resume ----------
function resume(view: Partial<ResumeView> | typeof LOADING): Handlers {
  const full: ResumeView | typeof LOADING =
    view === LOADING
      ? LOADING
      : {
          defaultText: "",
          mode: "default",
          customText: "",
          opportunityLabel: "",
          ...view,
        };
  return Object.fromEntries([handle(api.resumes.get, () => full)]);
}
const editor = (text: string) => () => (
  <ResumeEditor
    text={text}
    onSave={async (t) => log("onSave")(`${t.length} characters`)}
    onCancel={() => log("onCancel")(null)}
  />
);
const longResume = `${defaultResumeText}\n\n${"Led research, prototyping, and delivery across scheduling, billing, and patient messaging. ".repeat(170)}`;

export const scenarios: Scenario[] = [
  {
    id: "billing-free",
    group: "Billing",
    title: "Free plan, test mode",
    handlers: billing({}, {}),
    render: () => <Billing />,
  },
  {
    id: "billing-free-limit",
    group: "Billing",
    title: "Free plan, allowance reached",
    handlers: billing({}, { voiceMinutesUsed: 10, preparationsUsed: 3 }),
    render: () => <Billing />,
  },
  {
    id: "billing-plus-reserved",
    group: "Billing",
    title: "Plus, minutes reserved for open practice",
    handlers: billing(plus, {
      ...plusUsage,
      voiceMinutesUsed: 22.5,
      voiceMinutesReserved: 5,
      preparationsUsed: 6,
    }),
    render: () => <Billing />,
  },
  {
    id: "billing-pro-canceling",
    group: "Billing",
    title: "Pro, canceling at period end",
    handlers: billing(
      { ...plus, plan: "pro", cancelAtPeriodEnd: true, testMode: false },
      {
        voiceMinutesUsed: 48,
        voiceMinutesLimit: PLANS.pro.voiceMinutes,
        preparationsLimit: PLANS.pro.preparations,
      },
    ),
    render: () => <Billing />,
  },
  {
    id: "billing-past-due",
    group: "Billing",
    title: "Plus, payment past due",
    handlers: billing({ ...plus, status: "past_due" }, plusUsage),
    render: () => <Billing />,
  },
  {
    id: "billing-not-configured",
    group: "Billing",
    title: "Paid plans unavailable",
    handlers: billing({ configured: false }, {}),
    render: () => <Billing />,
  },
  {
    id: "billing-return-success",
    group: "Billing",
    title: "Back from Stripe checkout",
    search: "?billing=success",
    handlers: billing(plus, plusUsage),
    render: () => <Billing />,
  },
  {
    id: "billing-return-cancel",
    group: "Billing",
    title: "Checkout canceled",
    search: "?billing=cancel",
    handlers: billing({}, {}),
    render: () => <Billing />,
  },
  {
    id: "billing-checkout-error",
    group: "Billing",
    title: "Checkout fails (choose a plan)",
    handlers: billing({}, {}, [
      handle(api.billing.checkout, () =>
        Promise.reject({
          data: "Checkout is temporarily unavailable. Your plan is unchanged; try again in a few minutes.",
        }),
      ),
    ]),
    render: () => <Billing />,
  },
  {
    id: "billing-loading",
    group: "Billing",
    title: "Loading",
    handlers: Object.fromEntries([
      handle(api.billing.summary, () => LOADING),
      handle(api.usage.summary, () => LOADING),
    ]),
    render: () => <Billing />,
  },
  {
    id: "prep-first-run",
    group: "Preparation",
    title: "First run, no email set up",
    handlers: preparation([]),
    render: prep,
  },
  {
    id: "prep-inbox",
    group: "Preparation",
    title: "Email forwarding linked",
    handlers: preparation([], sharedInbox),
    render: prep,
  },
  {
    id: "prep-researching",
    group: "Preparation",
    title: "Researching a posting",
    handlers: preparation([researching]),
    render: prep,
  },
  {
    id: "prep-reading-email",
    group: "Preparation",
    title: "Reading a forwarded invitation",
    handlers: preparation([readingEmail], sharedInbox),
    render: prep,
  },
  {
    id: "prep-failed",
    group: "Preparation",
    title: "Preparation failed",
    handlers: preparation([failed]),
    render: prep,
  },
  {
    id: "prep-ready",
    group: "Preparation",
    title: "Brief ready from a posting",
    handlers: preparation([designer]),
    render: prep,
  },
  {
    id: "prep-ready-email",
    group: "Preparation",
    title: "Brief ready from email, with attachment issues",
    handlers: preparation([engineer], sharedInbox),
    render: prep,
  },
  {
    id: "prep-several",
    group: "Preparation",
    title: "Several opportunities",
    handlers: preparation(
      [designer, engineer, researching, failed, failedSameHost],
      sharedInbox,
    ),
    render: prep,
  },
  {
    id: "prep-loading",
    group: "Preparation",
    title: "Loading",
    handlers: preparation(LOADING, LOADING),
    render: prep,
  },
  {
    id: "resume-default-empty",
    group: "Resume",
    title: "Practice resume, nothing saved",
    panel: true,
    handlers: resume({}),
    render: () => <PracticeResume onMode={log("onMode")} />,
  },
  {
    id: "resume-default-saved",
    group: "Resume",
    title: "Practice resume, default saved",
    panel: true,
    handlers: resume({ defaultText: defaultResumeText }),
    render: () => <PracticeResume onMode={log("onMode")} />,
  },
  {
    id: "resume-default-loading",
    group: "Resume",
    title: "Practice resume, loading",
    panel: true,
    handlers: resume(LOADING),
    render: () => <PracticeResume onMode={log("onMode")} />,
  },
  {
    id: "resume-editor-empty",
    group: "Resume",
    title: "Editor, empty",
    handlers: {},
    render: editor(""),
  },
  {
    id: "resume-editor-filled",
    group: "Resume",
    title: "Editor, with text",
    handlers: {},
    render: editor(defaultResumeText),
  },
  {
    id: "resume-editor-too-long",
    group: "Resume",
    title: "Editor, over the character limit",
    handlers: {},
    render: editor(longResume),
  },
  {
    id: "resume-opportunity-no-default",
    group: "Resume",
    title: "Opportunity resume, no default saved",
    panel: true,
    handlers: resume({ mode: "default" }),
    render: () => <OpportunityResume opportunityId={oppId(1)} />,
  },
  {
    id: "resume-opportunity-custom",
    group: "Resume",
    title: "Opportunity resume, tailored copy",
    panel: true,
    handlers: resume({
      mode: "custom",
      defaultText: defaultResumeText,
      customText: "Jordan Lee — tailored for Northwind\n…",
    }),
    render: () => <OpportunityResume opportunityId={oppId(1)} />,
  },
  {
    id: "resume-opportunity-none",
    group: "Resume",
    title: "Opportunity resume, none (tailored copy kept)",
    panel: true,
    handlers: resume({
      mode: "none",
      customText: "Jordan Lee — tailored for Northwind\n…",
    }),
    render: () => <OpportunityResume opportunityId={oppId(1)} />,
  },
  {
    id: "resume-practice-opportunity",
    group: "Resume",
    title: "Practice resume, for an opportunity",
    panel: true,
    handlers: resume({
      mode: "custom",
      opportunityLabel: `${designerBrief.role} · ${designerBrief.company}`,
    }),
    render: () => (
      <PracticeResume opportunityId={oppId(1)} onMode={log("onMode")} />
    ),
  },
];
