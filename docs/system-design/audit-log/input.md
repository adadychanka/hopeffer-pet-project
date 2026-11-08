#### 2.3. Interview task: user action audit log

There is no ready-made solution: reason on your own. First sketch a solution without hints, then discuss it with an LLM: let it find the weak spots, and compare the options. The result is a container diagram and half a page of text: clarifying questions, assumptions, options with their cost, the choice, and what hits a limit first.

"The marketplace has grown into a platform: the database has hundreds of entities and tables. The platform needs a central log of actions: who did what, when, and to what. Dozens of operations by different roles must be tracked:

- the platform admin bans and unbans users
- the organization admin turns services on and off, grants and revokes access for team members, renews the subscription
- the moderator takes a listing down for moderation and puts it back
- sellers and buyers create and change listings, orders and reviews

Different roles use the log: the organization admin uses the log of their organization, the platform admin the log of the whole system, the moderator the moderation log, and support the log of user tickets. They search with filters by user, object, role and action type. There are gigabytes of events per day, and they must be kept for years: for disputes and audits."

**Study:** [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) (OWASP): which events to log and what must not go into the log.

Think through:

- **clarifying questions:** what do you ask the business before you design? Write the list: this is how requirements are gathered
- **scenarios instead of answers:** you do not have the business's answers yet. Make assumptions and model 2–3 growth scenarios, for example today's volume, ×10 in a year and ×100 in three years. For each one, give a solution and a threshold: at what volume, number of roles or retention period you change the solution, and what you move to
- **event fields:** what must a record contain to settle a dispute a year later? Make the list yourself
- **who sees what:** which fields and whose actions each role sees; what the user sees when they are banned or their listing is taken down
- **how not to lose an event:** the action succeeded, but the log record did not. How do you rule this out, and what do you pay for it?
- **immutability:** who can fix or delete a record, and how will anyone notice?
- **where you store it:** at least two options with their cost. How do search and filters work at this volume?
- **how it differs from technical logs:** the audit log is business data, kept for years, and must not be lost. Technical logs live for days; they can be sampled and lost
- **×10 events:** what hits a limit first?

**Acceptance criteria:**

- [ ] Container diagram; clarifying questions to the business and assumptions are written down
- [ ] 2–3 volume scenarios: a solution for each and the threshold to move to the next one
- [ ] Event fields and who sees what
- [ ] How an event is not lost and why it cannot be changed
- [ ] Two storage options with their cost and the choice; how search and filters work; what hits a limit first
