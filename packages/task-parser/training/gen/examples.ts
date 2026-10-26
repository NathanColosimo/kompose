/** Hand-checked examples shown to generators and auditors. */
export const EXAMPLES: { marked: string; tags: string[]; tagList: string[] }[] =
  [
    {
      marked:
        "[F:remind me to] [T:call mom about the trip] [S:tmrw at 4] for [M:30 min], [D:ask her to bring the passports]",
      tagList: ["Work", "Family", "Health"],
      tags: ["Family"],
    },
    {
      marked: "[T:finish q3 deck] by [U:thursday] [G:#work]",
      tagList: ["work", "personal", "side hustle"],
      tags: ["work"],
    },
    {
      marked: "[T:standup] [R:every weekday at 9:30] [M:15m]",
      tagList: ["💼 Job", "🏠 Home"],
      tags: ["💼 Job"],
    },
    {
      marked: "[T:pay rent] [R:every month] by [U:the 1st]",
      tagList: ["Finance", "Home", "Errands"],
      tags: ["Finance"],
    },
    {
      marked:
        "[S:next tue] [T:watch the new Friday Night Lights doc] [L:youtube.com/watch?v=x7Kp2]",
      tagList: ["Work", "Fitness"],
      tags: [],
    },
    {
      marked:
        "[F:ok so um i gotta] [T:book the vet for biscuit] [F:like] sometime [S:next week] [F:probably] [M:an hour] and [D:ask about the itchy ears thing]",
      tagList: ["Pets", "Home", "Money"],
      tags: ["Pets"],
    },
    {
      marked: "[G:clients]: [T:send invoice to Hartwell] [U:eow]",
      tagList: ["Clients", "Admin", "Personal"],
      tags: ["Clients"],
    },
    {
      marked: "[T:read 1984 for book club] before [U:march 3]",
      tagList: ["reading", "school"],
      tags: ["reading"],
    },
    {
      marked:
        "[T:draft the grant proposal] starting [S:monday], due [U:the 15th], [M:2-3 hours]",
      tagList: ["Research", "Teaching", "Admin"],
      tags: ["Research"],
    },
    {
      marked: "[T:call the landlord] when i get a chance [G:#apartment]",
      tagList: ["Home", "Work"],
      tags: [],
    },
    {
      marked: "[T:gym] [R:mon wed fri at 6am]",
      tagList: ["health", "work", "learning"],
      tags: ["health"],
    },
    {
      marked: "[T:buy a 2 hour parking pass for saturday's game] [S:tonight]",
      tagList: ["Errands", "Sports", "Family"],
      tags: ["Errands"],
    },
  ];
