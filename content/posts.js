// Blog posts. Body is a tiny Markdown subset: ## / ### headings, paragraphs, - and 1. lists, > quotes,
// **bold**, `code`, [text](/path or https://...). Examples with prices are illustrations, not market data.
// audience: 'providers' | 'customers'

export const posts = [
  {
    slug: 'stop-cooking-for-empty-doorsteps',
    title: 'Stop cooking for empty doorsteps: a simple leave policy for your tiffin service',
    description: 'Customers going on leave is the most common headache in the tiffin business. A short, clear leave policy fixes most of it.',
    audience: 'providers',
    emoji: '🏖️',
    date: '2026-10-24',
    body: `
Almost every tiffin provider has the same story. You cook the full batch, pack the boxes, reach the building, and the customer is in another city. Nobody told you. The food is wasted and the next argument is about whether this day goes on the bill.

The cause is rarely a bad customer. It is the **absence of a clear, easy way to say "I'm away"**. A leave message sent on a busy chat gets buried. A phone call at 7 am catches you mid-cooking. A good leave policy fixes this in three small steps.

## 1. Decide your cut-off time, and say it once

Pick a time by which a leave must be told so you can avoid buying and cooking for it. Many kitchens choose the evening before, because grocery and prep decisions are made then. Others allow same-day cancellation until early morning.

There is no single right answer. Pick the one that matches **when you actually buy and start cooking**. If you buy vegetables the evening before, a morning cut-off does not protect you.

In Tiffin Manager this is a setting: *Settings → Customer leave*. By default customers can mark leave from tomorrow onwards. You can allow cancelling today's tiffin until a chosen hour.

## 2. Decide what happens to the bill

Write down one rule and keep it. A few common options:

- **Leave told before the cut-off: not billed.** Simple and fair, and the one customers usually expect.
- **Leave told late: billed.** You already cooked and bought.
- **Long leave (for example a week or more): you may pause the subscription** and restart on the return date.

Whatever you choose, put it in your first welcome message. Most disputes happen only because the rule was never stated.

## 3. Give customers one easy place to tell you

The best leave system is the one the customer will actually use. A form they fill in on their own phone, in ten seconds, with a first and last day, beats any chat message.

With Tiffin Manager, each customer can log in with their phone number or use a personal link. They pick the days, and:

- your box count for those days drops automatically,
- you get a Telegram message the moment they mark it (see [how to set up Telegram](/blog/telegram-alerts-for-your-tiffin-business)),
- the days appear in your monthly report, so billing is easy to explain.

## 4. Handle the "I forgot to tell you" customer gracefully

It will still happen. When it does, don't improvise. Apply the rule you wrote, once, kindly. If you choose to make an exception, call it an exception and say so. Customers respect clear rules more than they resent them.

## A tiny checklist

1. Choose your cut-off time.
2. Write the billing rule in two lines.
3. Send both to every new customer.
4. Give customers a self-service way to mark leave.
5. Check tomorrow's count every evening before you shop.

That last step is the one that saves money. When the number of boxes you need is always in front of you, you stop guessing.
`,
  },
  {
    slug: 'telegram-alerts-for-your-tiffin-business',
    title: 'Get instant Telegram alerts for your tiffin business in 5 minutes',
    description: 'A step-by-step guide to connect the Tiffin Manager bot to your Telegram so you know the moment a customer takes leave.',
    audience: 'providers',
    emoji: '✈️',
    date: '2026-10-24',
    body: `
You do not need to keep the app open all day to know what is happening. Connect Telegram once and the app will message you when it matters.

## What you will receive

- **Customer leave alerts.** For example: "Sunita Rao is on leave, 25 to 27 Oct. Tomorrow: 11 to prepare."
- **A morning summary** of how many boxes to cook today and who is on leave.
- **An evening summary** of tomorrow's count, in time to plan your shopping.
- **New requests** from customers who found you in the marketplace.
- **Quick commands**: send /today, /tomorrow or /pending to the bot at any time.

## Connect in five steps

1. Install Telegram on your phone (it is free) and create your account if you do not have one.
2. In the Tiffin Manager app, open **Settings** and scroll to **Telegram alerts**. You will see the bot's name and your personal **connect code**.
3. In Telegram, search for that bot name and open it. Tap **Start**.
4. Send this message to the bot, using your own code: \`/start YOURCODE\`
5. The bot replies that you are connected. Back in the app, press **Send test** to confirm.

That is all. The code ties your Telegram to your kitchen only, so other providers using the same bot never see your customers.

## Choose when you hear from the bot

In the same Settings section you can change the morning and evening summary times, or clear a time to turn that summary off. Leave alerts always arrive instantly.

## If something does not work

- **"That code is not right"**: copy the code again from Settings. It is case-insensitive, and easily confused characters (0 and O, 1 and I) are never used in codes.
- **The bot does not reply at all**: the server owner may not have switched Telegram on yet. Ask them to check the setup in the [help guide](/help#telegram-owner).
- **You changed your phone**: in Settings press **Disconnect**, then connect again from the new phone. Disconnecting also changes your code, so the old one stops working.

The full guide, including the setup for whoever runs the system, is on the [help page](/help#telegram).
`,
  },
  {
    slug: 'normal-vs-deluxe-tiffin-pricing',
    title: 'Normal vs Deluxe: how to design two tiffin options customers actually understand',
    description: 'A practical way to build a two-tier tiffin menu, price it, and explain the difference without confusing anyone.',
    audience: 'providers',
    emoji: '✨',
    date: '2026-10-24',
    body: `
Offering two options, a normal tiffin and a deluxe one, is popular for good reason. It lets a budget-conscious customer say yes, and it lets a customer who wants more pay for more. But a badly explained second option creates confusion, extra work, and mistakes in the kitchen.

## Start from the work, not the price

Before you decide a price, decide what is **actually different** in the box. Customers should be able to describe the difference in one sentence. For example:

- Normal: dal, one vegetable, roti, rice.
- Deluxe: everything in Normal, plus a second vegetable, a sweet or a special item, and a larger portion.

If you cannot say it in one sentence, the tiers are too complicated. Complicated tiers lead to "I thought deluxe included paneer" conversations.

## Keep the kitchen simple

Every extra variation slows you down. A good test: **can you prepare the deluxe box by adding to the normal box**, rather than cooking a different meal? Adding a side is easy. Cooking a separate main for each deluxe customer is not.

This is also why a count matters. When you know the exact number of normal and deluxe boxes for the day, you can batch-cook the base and add the extras accurately. Tiffin Manager shows both numbers on the Today screen.

## Set the gap on purpose

An illustration: if the normal box costs 80 and the deluxe costs 120, the customer is paying 40 extra for the additions. Ask yourself: **does the extra food cost, plus a fair margin for the extra work, come to about 40?** If it does not, adjust the contents or the price. Do not guess.

The numbers above are only an example. Your costs, area and customers are your own. Work them out from your actual ingredient costs.

## Let customers move between tiers

Some customers will want deluxe only on certain days, such as a birthday or weekend. You can decide whether to allow it. If you do, make it a clear rule ("tell me by the evening before") and use the same cut-off as your leave policy.

## Name the tiers simply

"Normal" and "Deluxe" work because they need no explanation. Fancy names (Gold, Platinum, Royal) tend to make people ask what is inside. Keep the names plain and put the contents in your message.

## Review every few months

Look at which tier customers choose and why. If almost nobody picks deluxe, it may be priced too high or not different enough. If almost everybody picks it, your normal box may be underpriced or your deluxe is simply your standard, and the names are doing nothing.

In short: a clear difference in the box, a gap that covers real costs, and an easy way to count. That is what makes two tiers work.
`,
  },
  {
    slug: 'month-end-tiffin-billing-without-arguments',
    title: 'Month-end tiffin billing without arguments',
    description: 'How to keep a simple record of deliveries and leave days so your monthly bill is clear and nobody disputes it.',
    audience: 'providers',
    emoji: '🧾',
    date: '2026-10-24',
    body: `
Billing disputes are rarely about money. They are about memory. "I told you I was away on the 12th." "No, I delivered that day." Without a record, both people are guessing, and the customer's version feels as true to them as yours does to you.

The fix is boring and effective: **record the facts daily, and show them monthly.**

## What to record

For each customer and each day, only three things matter:

1. **Delivered**, with the time.
2. **On leave**, with who marked it and when.
3. **Not delivered and not on leave**, which is your problem to look at, not the customer's.

If you tick off deliveries as you go, the first record is automatic. If customers mark their own leave, the second is automatic too, and it comes with a date, so there is no "I told you on the phone."

## The monthly summary

At month end, send each customer a short message with the same four lines:

- Days delivered
- Days on leave
- Rate per box
- Total

Tiffin Manager's **Reports** screen has this ready. For each customer there is a button to send the summary on WhatsApp, and you can download the full month as a spreadsheet if you want to keep your own books.

## Handle the dispute without drama

If a customer questions a day:

1. Look at that date in your record.
2. Share what it says, kindly, without making it a contest.
3. If the record shows **you** missed a delivery, say so and do not bill for it. Customers remember fairness.

Being quick to admit your own errors is the cheapest way to build trust.

## Two habits that make it work

- **Tick deliveries the same day.** Back-filling from memory at month end defeats the purpose.
- **Agree on the rate and the leave rule at the start.** The record only helps if both sides agreed on what it counts. See [our leave policy guide](/blog/stop-cooking-for-empty-doorsteps).

One note: the amounts in reports use the prices currently set in your Settings. If you change prices mid-month, check the totals before sending them.
`,
  },
  {
    slug: 'first-20-tiffin-customers',
    title: 'Getting your first 20 tiffin customers without spending on ads',
    description: 'Practical, low-cost ways for a new home kitchen to find its first regular customers, and keep them.',
    audience: 'providers',
    emoji: '🌱',
    date: '2026-10-24',
    body: `
Starting a tiffin service is mostly a trust problem. People are choosing someone to feed them every day, so they want to be sure the food is clean, the timing is reliable, and you will still be there next month. The good news: you can build that trust cheaply, close to home.

## Start within a few minutes of your kitchen

Delivery time and temperature are your biggest quality factors. A tight area also keeps your delivery costs low. Choose a small radius first, such as a few buildings, a lane or a nearby office cluster, and become known there before you widen it.

## Offer a trial, not a commitment

Many people hesitate to subscribe to something they have not tasted. A short trial, such as a few days or a single sample box, removes that fear. Keep the trial simple to explain and mention that you will ask for honest feedback.

## Use the places people already talk

Residents' groups, office groups and neighbourhood chats are where "does anyone know a good tiffin?" gets asked. Do not post and vanish. Answer questions, share a clear menu and your delivery area, and let happy customers speak for you. Check each group's rules before you post.

## Make the first impression repeatable

On the first day of a new customer:

- deliver at the time you promised,
- send a short message afterwards asking if everything was fine,
- remember their notes (less spicy, no onion) and show that you did.

Small things, done every time, are what people recommend you for. In Tiffin Manager you can store a note per customer, and it appears on the delivery list.

## List yourself where people search

Customers who need a tiffin often search for one by location. A free listing in the [marketplace](/find) puts you in front of people near you. Add a clear one-line description, the food type, the meals you serve and your price, and set a delivery radius that you can really serve.

## Ask for introductions

After a few weeks, ask your happiest customers one specific question: "Do you know one colleague or neighbour who would like this?" A specific request is far more likely to get an answer than "please spread the word."

## Keep it professional behind the scenes

- Keep your kitchen and packaging clean, and be ready to show it.
- **Check what food-safety registration or licence your local rules require** for selling cooked food. In India this usually involves FSSAI, but rules and thresholds change, so verify the current requirements with the official authority rather than relying on this post.
- Track deliveries and leave properly so your service feels dependable from the start.

## A realistic goal

Twenty regular customers in a small area is a good, sustainable first target. Reach it by being reliable, not by being everywhere. Once you are, you will know what is worth paying for, if anything. See [whether advertising is worth it](/blog/is-advertising-worth-it-for-a-small-kitchen).
`,
  },
  {
    slug: 'is-advertising-worth-it-for-a-small-kitchen',
    title: 'Is paying for advertising worth it for a small tiffin kitchen?',
    description: 'An honest way to decide whether a paid ad makes sense for you, how to test it cheaply, and how to measure the result.',
    audience: 'providers',
    emoji: '📣',
    date: '2026-10-24',
    body: `
Short answer: it depends on one thing, **whether you have spare capacity**. An ad can bring customers, but if you cannot cook for more people, it only brings stress.

## First, check you have room

Look at your numbers honestly:

- How many boxes can you comfortably make and deliver each day?
- How many do you make now?
- How many extra could you take without lowering quality or being late?

If the answer is "none", fix that first or wait. If the answer is "a handful to a dozen", an ad can make sense.

## Free listing versus a paid ad

In the Tiffin Manager marketplace, a free listing already shows you to nearby customers who search. A paid ad adds a **Sponsored** spot near the top, but only for customers within the radius of the plan you buy. People far from your kitchen never see it, which keeps the ad relevant and keeps you from paying for views you could never serve.

So the question is not "listing or nothing". It is "do I want to be seen **first** by people near me?"

## Work out what a customer is worth

A simple estimate:

1. Your monthly charge per customer, minus ingredient and delivery cost, is roughly what each customer contributes.
2. Multiply by how many months a typical customer stays.
3. Compare that with the ad cost.

If one extra customer who stays a few months more than covers the cost of the ad, the idea is worth a small trial. If you need many customers to break even, think twice. These are your own figures, and the logic is only as good as your honest inputs.

## Test small and measure

Do not commit big. Choose the shortest plan, and before it starts, write down:

- how many join requests and calls you normally get in a month,
- how many customers you have.

The Grow screen shows how many times you were shown, how many calls and WhatsApp taps you got, and how many join requests came in. After the ad ends, compare. If the numbers barely moved, you have learned something cheaply.

## Make the ad work

An ad only gets people to look. These decide whether they join:

- A clear one-line description ("Fresh home-style veg meals, delivered hot").
- Your food type, meals and price shown honestly.
- A phone number that you answer, and quick replies to join requests.

Slow replies waste the money you spent to get the lead.

## When it is probably not worth it

- You are full already.
- You have not yet got the basics right: on-time delivery, consistent taste.
- You cannot reply to enquiries within a day.

## When it probably is

- You have capacity and want to fill it soon.
- You are new to an area and nobody knows you yet.
- Some customers have left (a building moved, an office closed) and you want to rebuild.

Treat advertising as a tool for a specific gap, not a permanent habit. Your best long-term growth is still happy customers telling their neighbours.
`,
  },
  {
    slug: 'how-to-choose-a-tiffin-service',
    title: 'How to choose a tiffin service: a checklist for customers',
    description: 'What to ask and check before you subscribe to a daily tiffin, so you get food you like and a service you can rely on.',
    audience: 'customers',
    emoji: '🍽️',
    date: '2026-10-24',
    body: `
Subscribing to a daily tiffin is a small commitment that you will feel every day. A few minutes of checking before you start saves a lot of frustration later.

## 1. Check that they deliver to you, on time

Start with the basics. Search by your location or pincode in the [marketplace](/find) to see services that deliver to your area, nearest first. Then ask:

- What time will it reach me, and how much can that vary?
- What happens if there is a delay?

Reliable timing matters more than a long menu.

## 2. Look at the food, honestly

- Ask for a sample or a short trial before a full subscription.
- Check that it fits your diet: vegetarian, Jain, less oil, less spicy, and so on.
- Ask whether you can add a note ("no onion", "less spice"). A good service will keep it on file.

## 3. Understand the options and price

Many services offer a normal and a deluxe box. Ask exactly what is different, not only the name. Then ask:

- What is the price per day, or per month?
- How is the month counted?
- Is there a delivery charge?

## 4. Ask about leave before you need it

Most people travel at some point. Ask now, while everyone is calm:

- How and by when should I tell you about leave?
- Am I charged for days I told you in time?
- Can the subscription be paused for a longer break?

A provider who has a clear answer has probably thought about it, and that is a good sign. If they use Tiffin Manager, you can mark your leave yourself in seconds from your own phone.

## 5. Notice how they communicate

You are choosing a person as much as a menu. Do they answer questions politely and promptly? Do they explain things clearly? How they behave before you pay is a preview of how they will behave when something goes wrong.

## 6. Check hygiene and registration

It is reasonable to ask about kitchen cleanliness and packaging. **Ask if they hold the food-safety registration or licence required where you live** (in India, usually FSSAI). Rules change, so if it matters to you, verify it with the official source.

## 7. Start small

Take the first week or month as a trial. Notice whether the food is fresh, the portion is right, the timing holds and your requests are remembered. If it is good, continue. If not, you have lost very little.

## A short checklist

1. They deliver to my area and the timing works.
2. I tasted it, and it suits my diet.
3. I know the price and what is included.
4. I know the leave rule.
5. They reply politely and quickly.
6. I am starting with a trial.

When you find a service you like, tell them. Reliable kitchens are built by customers who say what is working.
`,
  },
  {
    slug: 'going-on-holiday-how-to-pause-your-tiffin',
    title: 'Going on holiday? How to pause your tiffin politely and on time',
    description: 'A short guide for customers on telling your tiffin provider about leave, so you are not charged and they are not left with wasted food.',
    audience: 'customers',
    emoji: '🧳',
    date: '2026-10-24',
    body: `
A holiday, a family function or a few days off sick: every tiffin customer has days when they will not be home. How you tell your provider makes a real difference to both of you. Your provider cooks for a fixed number of people, and every box that nobody needs is wasted food and wasted money.

## Tell them as early as you can

The earlier they know, the less they cook and buy. As a rule of thumb, tell them as soon as your plans are fixed, and **before the cut-off time** your provider has set. Ask them what it is if you do not know.

## Give them the exact days

A message like "I'll be away next week" leaves room for mistakes. Give:

- the **first day** you do not need tiffin, and
- the **last day**, or the day you want it to restart.

Say it clearly, including if you want it to restart on a specific morning.

## Use the easiest method

If your provider uses Tiffin Manager, you can mark leave yourself:

1. Open the link they sent you, or log in with your phone number and password at [the login page](/login?role=customer). New here? [Create your login](/signup?role=customer) using the phone number your provider has saved.
2. Choose the first and last day.
3. Tap **Mark my leave**.

Your provider's box count updates automatically, and they are alerted. You can also cancel an upcoming leave from the same screen if your plans change.

## What if I forgot until the last minute?

Message or call your provider as soon as you remember. Be honest. Many providers will help if they have not started cooking, but they are not required to, and they may charge for the day. Following their stated rule politely is the best way to keep a good relationship.

## What about leave that has already started?

You can cancel the remaining days of a running leave yourself, starting from the earliest day your provider allows (usually tomorrow). If you need to come back today, call your provider, because they may already have cooked or planned.

## Thank your provider

A short "thanks for the notice, enjoy your trip" goes a long way. Providers who feel respected are more flexible when you really need it.

## If you are moving away

For a longer or permanent stop, tell your provider early and agree on a last day. Settle the final bill, and if you have time, leave them a good word. Small home kitchens depend on their reputation.

## Summary

1. Tell your provider early.
2. Give the first and last day.
3. Use the leave screen if they have one.
4. Call for anything urgent or already started.
5. Say thank you.
`,
  },
];
