// AUTO-CAPTURED from the Fallout wiki via the `fallout-quest-scraper` package
// (the `va-queststages` tables). A curated, offline snapshot of five real
// quests spanning Fallout: New Vegas, 3, and 4, chosen for structural variety:
// optional branches, single & multiple success terminals, and a failure
// terminal. Re-capture with:  pnpm --filter fallout-quest-scraper scrape
// ---------------------------------------------------------------------------
export interface QuestStageData {
  stage: number;
  status: string;
  finished: boolean;
  optional: boolean;
  description: string;
}
export interface QuestData {
  game: 'fnv' | 'fo3' | 'fo4';
  title: string;
  url: string;
  stages: QuestStageData[];
}

export const FALLOUT_QUESTS: QuestData[] = [
  {
    game: 'fnv',
    title: "Ant Misbehavin'",
    url: "https://fallout.fandom.com/wiki/Ant_Misbehavin'",
    stages: [
      {
        stage: 15,
        status: '',
        finished: false,
        optional: false,
        description: 'Restart the 2 array generators, then reset the main power breaker.'
      },
      {
        stage: 20,
        status: '',
        finished: false,
        optional: false,
        description: 'Kill all ants in the generator room.'
      },
      {
        stage: 35,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Loyal may have something to help with the ants.'
      },
      {
        stage: 40,
        status: '',
        finished: false,
        optional: true,
        description: "(Optional) Place Loyal's sonic emitter on the Ant mound."
      },
      {
        stage: 42,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Activate the sonic emitter.'
      },
      {
        stage: 45,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Return to Raquel and let her know the generators are running again.'
      }
    ]
  },
  {
    game: 'fnv',
    title: 'Veni, Vidi, Vici',
    url: 'https://fallout.fandom.com/wiki/Veni%2C_Vidi%2C_Vici',
    stages: [
      {
        stage: 10,
        status: '',
        finished: false,
        optional: false,
        description: 'Cross the dam and make your way to the western power plant.'
      },
      {
        stage: 11,
        status: '',
        finished: false,
        optional: true,
        description: "(Optional) Take out the snipers who've taken up position in the western portion of the dam."
      },
      {
        stage: 12,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Release the waiting Legion reinforcements inside the intake tower.'
      },
      {
        stage: 20,
        status: '',
        finished: false,
        optional: false,
        description: 'Find the enemy commander, General Oliver.'
      },
      {
        stage: 30,
        status: '',
        finished: false,
        optional: false,
        description: 'Kill General Oliver and the soldiers guarding him.'
      },
      {
        stage: 40,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Return to the Legate and tell him that General Oliver has been driven off.'
      },
      {
        stage: 41,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Return to the Legate and tell him that General Oliver has been killed.'
      }
    ]
  },
  {
    game: 'fo3',
    title: "Agatha's Song",
    url: "https://fallout.fandom.com/wiki/Agatha's_Song",
    stages: [
      {
        stage: 10,
        status: '',
        finished: false,
        optional: false,
        description: 'Recover the Soil Stradivarius from Vault 92.'
      },
      {
        stage: 20,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Locate Vault-Tec headquarters.'
      },
      {
        stage: 30,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Discover the location of Vault 92.'
      },
      {
        stage: 50,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Return to Agatha.'
      },
      {
        stage: 60,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Find a buyer for the Soil Stradivarius.'
      }
    ]
  },
  {
    game: 'fo3',
    title: 'Big Trouble in Big Town',
    url: 'https://fallout.fandom.com/wiki/Big_Trouble_in_Big_Town',
    stages: [
      {
        stage: 10,
        status: '',
        finished: false,
        optional: false,
        description: 'Ask the people of Big Town about their captured friends.'
      },
      {
        stage: 20,
        status: '',
        finished: false,
        optional: false,
        description: 'Rescue the Big Town captives from the Super Mutants.'
      },
      {
        stage: 25,
        status: '',
        finished: false,
        optional: false,
        description: 'Rescue Red.'
      },
      {
        stage: 30,
        status: '',
        finished: false,
        optional: false,
        description: 'Escort Red safely back to Big Town.'
      },
      {
        stage: 40,
        status: '',
        finished: false,
        optional: false,
        description: '[Optional] Rescue Shorty.'
      },
      {
        stage: 45,
        status: '',
        finished: false,
        optional: false,
        description: 'Escort Shorty safely back to Big Town.'
      },
      {
        stage: 49,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: "Explain Red's death to the people of Big Town. (If Red dies)"
      },
      {
        stage: 50,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Speak to Red about your reward.'
      }
    ]
  },
  {
    game: 'fo4',
    title: 'A Loose End',
    url: 'https://fallout.fandom.com/wiki/A_Loose_End',
    stages: [
      {
        stage: 15,
        status: '',
        finished: false,
        optional: false,
        description: 'Speak to Lancer Captain Kells'
      },
      {
        stage: 30,
        status: '',
        finished: false,
        optional: false,
        description: 'Kill Virgil'
      },
      {
        stage: 80,
        status: '',
        finished: false,
        optional: true,
        description: '(Optional) Spare Virgil and lie that you killed him'
      },
      {
        stage: 90,
        status: '',
        finished: false,
        optional: false,
        description: 'Report to Kells - if Virgil killed'
      },
      {
        stage: 254,
        status: 'Quest failed',
        finished: false,
        optional: false,
        description: 'Quest failed'
      },
      {
        stage: 255,
        status: 'Quest finished',
        finished: true,
        optional: false,
        description: 'Quest complete'
      }
    ]
  }
]
