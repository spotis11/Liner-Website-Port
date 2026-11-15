import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Liner System — Privacy",
  description:
    "How the Liner System Discord bot handles your data: what it processes, what it stores, and your rights.",
};

/**
 * Bot privacy statement for the Liner System Discord bot (the private bot of
 * the official Liner Discord server). Static page — the text is the policy
 * agreed by the server owner; channel/ticket references point to the Liner
 * Discord server itself.
 */
const sections: { title: string; body: string[]; table?: [string, string][] }[] = [
  {
    title: "1. What the bot processes",
    body: [
      "Discord account info: your user ID, username, nickname, avatar, roles, account creation date and when you joined the server.",
      "Messages: messages are checked in real time for moderation (spam, links, insults, NSFW, English-only rule), auto answers and the level system. Message content is not saved by the bot outside of Discord.",
      "Things you enter: ticket forms, suggestions, an optional AFK reason (staff) and ticket ratings.",
    ],
  },
  {
    title: "2. What the bot stores",
    body: [
      "The bot saves a few small files on the server it runs on. They only contain what is needed for its features:",
    ],
    table: [
      ["Warnings (user ID, reason, moderator, date) and insult warning counters", "Moderation: every 3rd warning leads to a timeout"],
      ["XP and level (user ID)", "Level system, /rank and /leaderboard"],
      ["Ticket claims (ticket and staff user ID)", "Showing which staff member handles a ticket"],
      ["AFK status and reason (staff only)", "Telling others that a staff member is away"],
      ["Votes from the old suggestion system (user IDs)", "Counting votes"],
      ["Bot settings (e.g. applications open/closed, known issues)", "Bot configuration, no personal data"],
    ],
  },
  {
    title: "3. What we don't do",
    body: [
      "We don't sell or share your data with anyone.",
      "We don't use your data or messages to train AI or machine learning models.",
      "We don't track you outside of our Discord server.",
    ],
  },
  {
    title: "4. How long data is kept",
    body: [
      "Warnings and XP are kept until staff removes them or you ask us to delete them. Closed tickets are deleted automatically after 24 hours (the transcript stays in the staff log). Backups of the bot files are posted daily in a private staff channel.",
    ],
  },
  {
    title: "5. Your rights",
    body: [
      "You can ask us which data the bot has about you, or ask us to delete it. Open a ticket in #tickets on the Liner Discord server. Moderation data needed to keep the server safe (for example warnings) may be kept as long as it is needed for that.",
    ],
  },
  {
    title: "6. Discord",
    body: ["The bot works through Discord. Discord's own Privacy Policy also applies."],
  },
  {
    title: "7. Changes & contact",
    body: [
      "If the bot changes what it stores, we update this page. Questions? Open a ticket on the Liner Discord server.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-zinc-100">
      <p className="mb-1 text-sm font-medium tracking-wide text-zinc-400">
        Liner System
      </p>
      <h1 className="mb-4 text-3xl font-bold">Bot Privacy</h1>
      <p className="mb-10 leading-relaxed text-zinc-300">
        &ldquo;Liner System&rdquo; is the private Discord bot of the official
        Liner Discord server. It only runs on our own server. This page explains
        which data the bot uses and why.
      </p>
      {sections.map((s) => (
        <section key={s.title} className="mb-9">
          <h2 className="mb-3 text-xl font-semibold">{s.title}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="mb-3 leading-relaxed text-zinc-300">
              {p}
            </p>
          ))}
          {s.table ? (
            <div className="overflow-hidden rounded-lg border border-zinc-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-800/80 text-zinc-200">
                  <tr>
                    <th className="px-4 py-2 font-medium">Data</th>
                    <th className="px-4 py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-300">
                  {s.table.map(([data, why], i) => (
                    <tr key={i} className="border-t border-zinc-700/70">
                      <td className="px-4 py-2 align-top">{data}</td>
                      <td className="px-4 py-2 align-top">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ))}
      <p className="mt-10 text-sm text-zinc-500">
        Liner System — private bot of the official Liner Discord server.
      </p>
    </main>
  );
}
