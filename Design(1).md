# ServeAI — Design System & Product UI Direction

**Version:** Hackathon V1  
**Product:** ServeAI — Autonomous Local Services Agent
**Primary flow:** User asks for a local service → ServeAI collects constraints → searches providers → contacts them → waits for replies → evaluates offers → books the service.

---

## 1. Design Vision

ServeAI should not look like a traditional chatbot.

The visual goal is to make the product feel like a **minimal command center for getting real-world tasks done**.

The user speaks naturally. ServeAI converts that language into structured intent, performs work in the background, surfaces operational progress, and returns a concrete outcome.

The interface should communicate:

- competence;
- speed;
- trust;
- calm;
- autonomy;
- clarity;
- real-world execution.

### Core statement

> ServeAI is not a messenger.
> ServeAI is an agent workspace.

The visual language should feel closer to:

- ChatGPT Agent — conversational shell + visible execution;
- Linear — restraint, workflow semantics, system states;
- Perplexity — structured objects embedded into conversational content;
- Intercom Fin — conversational support mixed with actionable components.

Approximate visual influence:

- **40% Linear**
- **30% ChatGPT Agent**
- **20% Perplexity**
- **10% ServeAI identity**

---

# 2. Product Personality

ServeAI is:

- direct;
- neutral;
- competent;
- composed;
- precise;
- useful;
- quiet.

ServeAI is not:

- playful;
- overly friendly;
- mascot-driven;
- futuristic;
- neon;
- gradient-heavy;
- “AI magical”;
- verbose;
- overly conversational.

Avoid generic AI aesthetics such as:

- glowing purple gradients;
- sparkles everywhere;
- glassmorphism;
- oversized AI avatars;
- floating orb assistants;
- excessive rounded bubbles;
- rainbow accents.

The product should look like software you trust with a real appointment.

---

# 3. Core Interaction Model

The ServeAI conversation has **three distinct visual languages**.

## 3.1 Conversation

Natural language between user and ServeAI.

Example:

> Preciso de um chaveiro.

ServeAI:

> Onde você precisa do serviço?

Conversation should be visually lightweight.

The user may use a subtle message pill, but ServeAI responses should generally live directly on the canvas rather than inside large assistant bubbles.

---

## 3.2 Work

Actions ServeAI is currently performing.

Examples:

- Searching;
- Comparing;
- Contacting;
- Waiting;
- Evaluating;
- Booking.

These are **not chat messages**.

They should be rendered as structured execution UI.

Example:

```text
Finding a locksmith

✓ Searched Pinheiros
✓ Found 14 providers nearby
✓ Contacted 3 providers
○ Waiting for replies
```

---

## 3.3 Result

Real-world outcomes.

Examples:

- provider found;
- offer received;
- appointment booked;
- calendar event created.

These should use stronger structured components.

Example:

```text
Booked

Chaveiro Pinheiros

Today
15:30

R$180

✓ Added to Google Calendar
✓ Provider confirmed
```

---

# 4. Design Principles

## 4.1 Not a Messenger App

Do not recreate WhatsApp.

Avoid alternating large left/right chat bubbles.

ServeAI content should live naturally on the main surface.

---

## 4.2 Content Lives on the Canvas

Assistant output should be rendered directly into the interface.

Use cards only when the information itself is a meaningful object:

- provider;
- offer;
- structured request;
- result;
- booking.

Do not wrap every ServeAI response inside a card.

---

## 4.3 Natural Language Becomes Structure

Information extracted from conversation should become persistent, editable UI.

Example:

```text
Location
Pinheiros, São Paulo

Budget
Up to R$200

When
Today · 14:00–18:00
```

This shows the user what ServeAI understood.

---

## 4.4 Execution States Replace “Typing…”

Never show:

> ServeAI is typing...

Prefer explicit operational states:

- Searching;
- Contacting;
- Waiting;
- Needs input;
- Evaluating;
- Booking;
- Done.

The user should always understand what ServeAI is doing.

---

## 4.5 Progressive Disclosure

ServeAI should only show the information needed for the current stage.

Do not show the full operational system from the beginning.

The UI progressively evolves:

```text
Ask
↓
Collect
↓
Work
↓
Result
```

---

## 4.6 Calm Autonomy

Autonomous actions should feel controlled, not chaotic.

Avoid excessive animation or rapidly changing elements.

ServeAI should communicate:

> I understand the constraints. I am handling it.

---

# 5. Visual Direction

## Style

- monochrome;
- black and white;
- editorial;
- high whitespace;
- thin borders;
- low visual noise;
- minimal shadows;
- subtle rounded corners;
- strong typography;
- precise spacing.

Think:

**premium productivity software rather than consumer messenger.**

---

# 6. Color Palette

The interface is intentionally monochromatic.

Do not use pure black and pure white for every layer. Use subtle grayscale separation to create hierarchy.

## Core Tokens

| Token | Value | Usage |
|---|---|---|
| `background` | `#FFFFFF` | Main application background |
| `foreground` | `#0A0A0A` | Primary text |
| `muted-foreground` | `#737373` | Secondary text |
| `tertiary` | `#A3A3A3` | Low-emphasis metadata |
| `surface` | `#F7F7F6` | Subtle cards / selected surfaces |
| `surface-hover` | `#F2F2F0` | Hover state |
| `border` | `#E8E8E5` | Default borders |
| `border-strong` | `#D4D4D0` | Strong separators |
| `inverse` | `#0A0A0A` | Primary buttons / inverted surfaces |
| `inverse-foreground` | `#FFFFFF` | Text on inverse |

---

## Semantic State Colors

Hackathon V1 should remain nearly monochrome.

Prefer icons and text instead of color coding.

Examples:

```text
✓ Done
○ Pending
◌ Waiting
! Needs input
```

If semantic color is introduced later, it should be extremely restrained.

---

# 7. Typography

## Primary Typeface

**Geist**

Fallback:

```css
font-family:
  Geist,
  Inter,
  ui-sans-serif,
  system-ui,
  sans-serif;
```

Geist fits ServeAI because it feels:

- modern;
- neutral;
- technical;
- precise;
- product-oriented.

Avoid rounded or overly friendly fonts.

---

## Typography Scale

### Display

```text
40–48px
Weight: 500–600
Tracking: -0.03em
```

Usage:

- empty state;
- major success state;
- major page title.

Example:

> What do you need?

---

### H1

```text
32px
Weight: 550–600
Line height: 1.15
Tracking: -0.025em
```

---

### H2

```text
24px
Weight: 500–600
Line height: 1.2
Tracking: -0.02em
```

---

### Conversation

```text
17–18px
Weight: 400
Line height: 1.5
Tracking: -0.01em
```

---

### Agent Question

```text
17px
Weight: 450–500
Line height: 1.45
```

---

### Body

```text
15–16px
Weight: 400
Line height: 1.5
```

---

### Metadata

```text
13px
Weight: 450–500
Line height: 1.4
```

---

### Micro Status

```text
12–13px
Weight: 450–500
```

---

### Numbers / Prices

```text
28–32px
Weight: 500
Tracking: -0.03em
```

---

## Weight Philosophy

Do not overuse bold typography.

Main weights:

```text
400
450
500
```

Use `600` only for rare emphasis.

Avoid `700+` unless absolutely necessary.

---

# 8. Layout

## Desktop

Max content width:

```text
760–860px
```

ServeAI should feel focused.

Do not fill the whole screen with panels for V1.

Recommended shell:

```text
┌──────────────────────────────────────────────┐
│ ServeAI                             New task   │
│                                              │
│                                              │
│       Main conversation / task surface       │
│                                              │
│                                              │
│                                              │
│                                              │
│       Composer fixed near bottom             │
└──────────────────────────────────────────────┘
```

---

## Mobile

Use full width with:

```text
16–20px horizontal padding
```

Cards:

```text
12–16px radius
```

Main composer:

```text
16–20px radius
```

Maintain strong whitespace.

---

# 9. Core Primitive Components

ServeAI V1 should be built primarily from five primitives.

---

## 9.1 Message

Represents conversational content.

### User

A subtle pill is allowed.

Example:

```text
Preciso de um chaveiro
```

Visual:

- light gray surface;
- minimal padding;
- no shadow;
- aligned right or slightly indented.

### ServeAI

Do not use a bubble.

Render text directly on the canvas.

---

# 9.2 Parameter

Represents structured information extracted from conversation.

Examples:

```text
⌖ Pinheiros, São Paulo

◷ Today · 14:00–18:00

R$ Up to R$200
```

Parameters should be:

- editable;
- persistent;
- compact;
- trustworthy.

### Example block

```text
I have what I need.

LOCATION
Pinheiros, São Paulo              Change

BUDGET
Up to R$200                       Change

WHEN
Today · 14:00–18:00               Change
```

---

# 9.3 AgentActivity

Represents ServeAI doing work.

Example:

```text
Finding a locksmith

✓ Searching nearby
✓ Found 14 providers
✓ Contacted 3
○ Waiting for replies
```

Properties:

- no heavy card;
- subtle border or no border;
- lightweight iconography;
- timestamps optional;
- state changes animate gently.

---

# 9.4 Entity

Represents a real-world object.

For V1:

**Provider**

Example:

```text
Chaveiro Pinheiros

★ 4.8 · 128 reviews
1.2 km away
```

Entity components can include:

- business name;
- rating;
- number of reviews;
- distance;
- status;
- source.

---

# 9.5 Outcome

Represents a completed real-world action.

Examples:

- offer received;
- booked;
- calendar event created.

Outcome components receive stronger hierarchy than normal messages.

Example:

```text
✓ Booked

Chaveiro Pinheiros

Today · 15:30
R$180

Added to Calendar
Provider confirmed
```

---

# 10. Core Application States

ServeAI needs explicit execution states.

## Searching

Icon:

```text
magnifying glass
```

Label:

```text
Searching nearby
```

---

## Contacting

Icon:

```text
phone / send / arrow
```

Label:

```text
Contacting providers
```

---

## Waiting

Icon:

```text
subtle spinner / incomplete circle
```

Label:

```text
Waiting for replies
```

This is especially important because ServeAI is asynchronous.

---

## Needs Input

Icon:

```text
?
```

Label:

```text
Needs your input
```

Example:

> The locksmith asked what type of lock you have.

---

## Evaluating

Label:

```text
Comparing offer with your preferences
```

---

## Booked

Icon:

```text
check
```

Label:

```text
Booked
```

---

# 11. Screen Flow

The main UI should evolve through four major states.

---

# Screen 01 — Start

Purpose:

Create an extremely simple entry point.

### Layout

```text
ServeAI


What do you need?


┌──────────────────────────────────────────┐
│ Tell ServeAI what you need...              │
│                                      ↑   │
└──────────────────────────────────────────┘


Use my location


Examples

Chaveiro perto de mim
Consertar meu ar-condicionado
Encanador hoje
Limpeza do apartamento
```

### Rules

No:

- dashboard;
- sidebar;
- chatbot avatar;
- AI sparkle;
- greeting paragraph;
- large navigation.

The product should feel immediately usable.

---

# Screen 02 — Collect

The conversation begins and ServeAI extracts structured information.

Example user input:

> Preciso de um chaveiro em Pinheiros hoje à tarde.

ServeAI renders:

```text
Got it. Here's what I have:

Service
Chaveiro

Location
Pinheiros, São Paulo

When
Today · 14:00–18:00
```

Then:

> Quanto você gostaria de gastar?

If user says:

> Até R$200.

The structured object updates.

---

## Fast Extraction

If user gives everything at once:

> Preciso de um chaveiro em Pinheiros hoje entre 14 e 18h. Posso gastar até R$200.

ServeAI should not ask redundant questions.

Immediately render:

```text
⌖ Pinheiros, São Paulo
◷ Today · 14:00–18:00
R$ Up to R$200
```

Then only ask what is missing.

Example:

> O que aconteceu com a fechadura?

---

# Screen 03 — Work

ServeAI now has enough information.

Transition:

> I have everything I need.

Then show the execution state.

```text
Finding a locksmith

✓ Searching near Pinheiros
✓ Found 14 nearby providers
✓ Selected 3 strong matches
✓ Contacted providers
○ Waiting for replies
```

Below:

```text
Request

Chaveiro
Pinheiros
Today · 14:00–18:00
Up to R$200
```

Copy:

> You don't need to stay here.  
> I'll let you know when someone responds.

This state should communicate autonomy.

---

# Screen 04 — Offer

When a provider replies:

```text
New offer


CHAVEIRO PINHEIROS
★ 4.8 · 128 reviews
1.2 km away


Price
R$180

Arrival
15:30


✓ Within your R$200 budget
✓ Inside your 14:00–18:00 window
✓ Service available
```

CTA:

```text
Book now
```

Secondary action:

```text
View other options
```

If ServeAI is configured for autonomous booking and all user constraints are satisfied:

```text
Matches your preferences.

Booking it now...
```

The system can proceed without asking again.

---

# Screen 05 — Booked

This is the strongest success moment.

```text
✓ Booked


Chaveiro Pinheiros

Today
15:30

R$180


✓ Added to Google Calendar
✓ Provider confirmed


View appointment
```

Use significant whitespace.

Do not celebrate with confetti.

The feeling should be:

> handled.

---

# 12. Composer

The composer is one of the most important elements.

### Default

```text
┌──────────────────────────────────────────┐
│ Tell ServeAI what you need...          ↑   │
└──────────────────────────────────────────┘
```

Optional actions:

- microphone;
- location;
- attachment later.

Avoid toolbar clutter.

---

## Active Task Composer

Once a task is underway:

```text
┌──────────────────────────────────────────┐
│ Ask something or adjust the request... ↑ │
└──────────────────────────────────────────┘
```

This communicates that the user can steer the agent while it works.

---

# 13. Buttons

## Primary

```text
Background: #0A0A0A
Text: #FFFFFF
Radius: 10–12px
Height: 44–48px
```

Examples:

```text
Find a locksmith
Book now
View appointment
```

---

## Secondary

```text
Background: transparent / white
Border: #E8E8E5
Text: #0A0A0A
```

Examples:

```text
View details
See other options
Change
```

---

## Avoid

- pill buttons everywhere;
- oversized radius;
- colored CTA;
- gradient buttons.

---

# 14. Cards

Cards should only exist when they represent meaningful structured information.

Allowed:

- provider;
- offer;
- request summary;
- booking;
- action result.

Avoid cards around:

- plain ServeAI text;
- every execution step;
- generic messages.

### Card Style

```text
Background: #FFFFFF
Border: 1px solid #E8E8E5
Radius: 12–14px
Shadow: none or extremely subtle
```

---

# 15. Iconography

Use a thin, minimal icon system.

Recommended:

- Lucide;
- 1.5px stroke;
- 16–18px default.

Core icons:

- Search;
- MapPin;
- Calendar;
- Clock;
- Mail;
- Phone;
- Check;
- Circle;
- CircleDashed;
- ChevronRight;
- SlidersHorizontal;
- ArrowUp.

Avoid decorative icons.

Every icon must communicate function or status.

---

# 16. Motion

Motion should reinforce state transitions.

Not decoration.

## Recommended durations

```text
micro interaction:
120–180ms

component transition:
180–260ms

state transition:
250–350ms
```

---

## Execution Progress

When ServeAI performs actions:

```text
Searching
↓
Found
↓
Contacting
↓
Waiting
```

Each completed line should gently transition from:

```text
○
```

to:

```text
✓
```

Do not animate the entire screen.

---

## Offer Arrival

Suggested animation:

1. waiting state remains still;
2. spinner completes;
3. `New offer` text appears;
4. offer component fades/slides in 8–12px;
5. status transitions to evaluation.

Total animation:

~300–450ms.

---

## Booked Transition

Use:

- subtle scale/fade of check;
- text appears;
- calendar confirmation follows.

No confetti.

No bouncing.

No celebration modal.

---

# 17. Copywriting Style

ServeAI copy must be:

- short;
- confident;
- specific;
- action-oriented.

Avoid:

> Perfeito! 😊 Eu ficaria super feliz em ajudá-lo a encontrar um chaveiro próximo de você!

Prefer:

> Claro. Onde você precisa do serviço?

Avoid:

> Estou aqui para ajudar!

Prefer:

> Vou procurar opções próximas.

Avoid:

> Aguarde enquanto nossa inteligência artificial analisa os melhores fornecedores...

Prefer:

> Searching nearby.

---

## Success Copy

Prefer:

> Resolvido.

Then details.

Example:

```text
Resolvido.

O Chaveiro Pinheiros chega às 15:30 por R$180.
Já adicionei o compromisso à sua agenda.
```

---

# 18. Empty State Examples

Use simple actionable examples.

```text
Preciso de um chaveiro

Encontre um encanador hoje

Meu ar-condicionado parou

Preciso de limpeza amanhã
```

Avoid marketing copy in the actual product surface.

---

# 19. Provider Offer Component

Recommended structure:

```text
┌─────────────────────────────────────────┐
│ Chaveiro Pinheiros                ★ 4.8 │
│ 128 reviews · 1.2 km                    │
│                                         │
│ Price                   Arrival          │
│ R$180                   15:30            │
│                                         │
│ ✓ Within budget                         │
│ ✓ Within availability                   │
│                                         │
│ [ Book now ]                            │
│                                         │
│ View details                            │
└─────────────────────────────────────────┘
```

Priority hierarchy:

1. provider;
2. price;
3. arrival;
4. compatibility;
5. secondary metadata.

---

# 20. Request Summary Component

Example:

```text
Request

Service
Chaveiro

Problem
Locked out

Location
Pinheiros, São Paulo

Budget
Up to R$200

Availability
Today · 14:00–18:00
```

Each editable property can expose:

```text
Change
```

on hover or tap.

---

# 21. Waiting State

This deserves special attention.

```text
Finding someone for you


✓ Request understood

✓ 14 locksmiths nearby

✓ 3 providers contacted

◌ Waiting for replies


You don't need to stay here.

I'll let you know when someone responds.
```

Below:

```text
Request
Pinheiros · Today
14:00–18:00 · ≤ R$200
```

The visual tone should be calm.

No fake percentage progress.

No countdown.

---

# 22. Information Hierarchy

For every screen ask:

### What is happening?

Example:

> Waiting for replies

### What has already happened?

Example:

```text
✓ 3 providers contacted
```

### What does ServeAI need from the user?

Example:

> The locksmith asked what type of lock you have.

### What is the next likely result?

Example:

> Provider response → Offer → Booking

The answer should always be visually obvious.

---

# 23. Desktop Header

Minimal.

Example:

```text
ServeAI                                      New task
```

Optional:

- history;
- settings;
- user menu.

Do not make the header visually dominant.

---

# 24. Mobile Header

```text
☰                  ServeAI                sliders
```

or:

```text
←                  ServeAI                 •••
```

depending on state.

Keep the brand small.

The task itself is the hero.

---

# 25. Brand Mark

Use the generated ServeAI symbol together with the wordmark:

```text
ServeAI
```

as the primary mixed-case wordmark.

Typography:

- Geist;
- weight 600;
- slightly tightened tracking.

Keep the symbol visually quiet so the task remains the hero.

A standalone geometric:

```text
S
```

formed by two connected paths inside a monochrome rounded square may be used for:

- favicon;
- app icon;
- provider notification identity.

---

# 26. Responsive Behavior

## Desktop

- centered column;
- max width ~820px;
- composer aligned to content width;
- cards may expand to full conversation width.

## Tablet

- max width ~680px;
- same hierarchy.

## Mobile

- full width;
- 16px padding;
- cards stack vertically;
- no side panels;
- primary CTA full width when needed.

---

# 27. Accessibility

Minimum:

- AA contrast;
- visible keyboard focus;
- 44px touch targets;
- status never represented by icon alone;
- spinner must have text;
- user must be able to interrupt agent execution;
- editable constraints must be clearly interactive.

---

# 28. Implementation Tokens

Suggested Tailwind-style values.

```ts
export const fieldTheme = {
  colors: {
    background: "#FFFFFF",
    foreground: "#0A0A0A",
    mutedForeground: "#737373",
    tertiary: "#A3A3A3",
    surface: "#F7F7F6",
    surfaceHover: "#F2F2F0",
    border: "#E8E8E5",
    borderStrong: "#D4D4D0",
    inverse: "#0A0A0A",
    inverseForeground: "#FFFFFF",
  },

  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    composer: "18px",
  },

  spacing: {
    pageMobile: "16px",
    pageDesktop: "24px",
    section: "32px",
  },

  motion: {
    fast: "150ms",
    normal: "220ms",
    state: "320ms",
  },
};
```

---

# 29. Suggested Component Architecture

```text
<FieldShell />

  <Header />

  <Conversation />

    <UserMessage />

    <AgentMessage />

    <RequestParameters />

      <Parameter />

    <AgentActivity />

      <ActivityStep />

    <ProviderEntity />

    <ProviderOffer />

    <BookingOutcome />

  <Composer />
```

---

# 30. Hackathon P0 Design Scope

Implement these first:

- [ ] Start screen
- [ ] Chat shell
- [ ] User message
- [ ] ServeAI response without bubble
- [ ] Composer
- [ ] Parameter extraction component
- [ ] AgentActivity component
- [ ] Provider result card
- [ ] Offer card
- [ ] Booked outcome
- [ ] Searching state
- [ ] Contacting state
- [ ] Waiting state
- [ ] Needs-input state
- [ ] Booked state

---

# 31. P1 Polish

Only after P0 works:

- subtle transitions;
- animated execution checklist;
- provider avatars/logo;
- rating source;
- history screen;
- responsive desktop polish;
- dark mode;
- richer request editing;
- location preview;
- calendar preview.

---

# 32. Do / Don't

## Do

- use whitespace;
- use direct copy;
- surface agent state;
- expose structured constraints;
- make outcomes visually important;
- make real-world entities feel tangible;
- allow users to steer tasks;
- keep components quiet.

## Don't

- build WhatsApp;
- use assistant bubbles everywhere;
- add unnecessary dashboards;
- use giant cards for plain text;
- use colorful AI visuals;
- use fake progress percentages;
- animate everything;
- overuse bold;
- overuse rounded pills;
- create a mascot;
- add marketing language inside task execution.

---

# 33. Final UX Principle

Every important moment in ServeAI should fit into this framework:

```text
TALK
Natural language

↓

UNDERSTAND
Structured constraints

↓

ACT
Visible execution

↓

RESULT
Real-world outcome
```

The user should feel that they did not merely receive information.

They delegated a problem.

ServeAI handled it.

---

# 34. Final Brand Direction

## ServeAI

**Say what you need. Consider it handled.**

Alternative product UI copy:

> What do you need?

and after completion:

> Handled.

These two phrases capture the complete interaction model of the product.

---

# 35. Moodboard Summary

Visual foundation:

```text
Minimal
Monochrome
Editorial
Agentic
Operational
Quiet
Structured
High-trust
```

Reference direction:

```text
Linear
×
ChatGPT Agent
×
Perplexity
×
Intercom Fin
```

Result:

> A conversational interface that progressively transforms natural language into structured operations and real-world outcomes.
