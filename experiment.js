// ─── Constants & Cached Templates ───────────────────────────────────────────────
const speciesDict = {
  "Bird A": "white_pelican",
  "Bird B": "summer_tanager",
  "Bird C": "horned_puffin",
  "Bird D": "ovenbird",
  "Bird E": "wilson_warbler",
};
const speciesList = Object.entries(speciesDict);

let TEMPLATES = {}; // will hold all loaded templates

// ─── Utilities ───────────────────────────────────────────────────────────────────
async function loadHTML(path) {
  const response = await fetch(path);
  return response.text();
}

async function loadJSON(path) {
  const response = await fetch(path);
  return response.json();
}

function shuffle(array) {
  return array
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}

// ─── Template Loader ─────────────────────────────────────────────────────────────
async function loadTemplates() {
  const paths = {
    list: "templates/list.html",
    manual: "templates/manual.html",
    species: "templates/species.html",
    trial: "templates/trial.html",
    quiz: "pages/quiz.html",
  };
  const contents = await Promise.all(Object.values(paths).map(loadHTML));
  Object.keys(paths).forEach((key, i) => (TEMPLATES[key] = contents[i]));
}

// ─── HTML Renderers ──────────────────────────────────────────────────────────────
function renderManual(shuffled = false) {
  const items = shuffled ? shuffle(speciesList) : speciesList;
  return Mustache.render(TEMPLATES.manual, {
    species: items.map(([id, species]) => ({ id, species })),
  });
}

function renderTrialHTML(features) {
  const listHTML = Mustache.render(TEMPLATES.list, { features });
  const manualHTML = renderManual();
  return Mustache.render(TEMPLATES.trial, {
    list_html: listHTML,
    manual_html: manualHTML,
  });
}

// ─── Experiment Loaders ──────────────────────────────────────────────────────────
async function loadWelcome() {
  const welcomeHTML = await loadHTML("pages/welcome.html");
  return {
    type: jsPsychInstructions,
    pages: [welcomeHTML],
    show_clickable_nav: true,
  };
}

async function loadFeaturesIntro() {
  const staticPages = await Promise.all([
    loadHTML("pages/features/intro_1.html"),
    loadHTML("pages/features/intro_2.html"),
    loadHTML("pages/features/intro_3.html"),
  ]);

  const examples = ["coloration", "patterns", "shape_size"];
  const dynamicPages = await Promise.all(
    examples.map(async (list, i) => {
      const [page, features] = await Promise.all([
        loadHTML(`pages/features/intro_${i + 4}.html`),
        loadJSON(`content/features/${list}.json`),
      ]);
      const listHTML = Mustache.render(TEMPLATES.list, { features });
      return Mustache.render(page, { list_html: listHTML });
    })
  );

  return {
    type: jsPsychInstructions,
    pages: [...staticPages, ...dynamicPages],
    show_clickable_nav: true,
  };
}

async function loadSpeciesIntro() {
  const [introHTML, summaryTemplate] = await Promise.all([
    loadHTML("pages/species/intro.html"),
    loadHTML("pages/species/summary.html"),
  ]);

  const intro = {
    type: jsPsychInstructions,
    pages: [introHTML],
    show_clickable_nav: true,
  };

  const examples = speciesList.map(([id, species]) => ({
    type: jsPsychSurveyText,
    preamble: Mustache.render(TEMPLATES.species, { id, species }),
    questions: [
      {
        prompt: "Type a one-sentence description of the bird here:",
        rows: 2,
        columns: 60,
        required: true,
      },
    ],
    data: { phase: "species_description", species },
  }));

  const summary = {
    type: jsPsychInstructions,
    pages: [
      Mustache.render(summaryTemplate, {
        manual_html: renderManual(true),
      }),
    ],
    show_clickable_nav: true,
  };

  return [intro, examples, summary];
}

async function loadQuizzes(jsPsych) {
  const quizzesList = ["summer_tanager", "horned_puffin"];
  const quizzes = await Promise.all(
    quizzesList.map(async (species) => {
      const features = await loadJSON(`content/quiz/${species}.json`);
      const preamble = Mustache.render(TEMPLATES.quiz, {
        trial_html: renderTrialHTML(features),
      });

      const trial = {
        type: jsPsychSurveyMultiChoice,
        preamble,
        questions: [
          {
            prompt: "What is the species of this bird?",
            name: "bird_choice",
            options: Object.keys(speciesDict),
            required: true,
            horizontal: true,
          },
        ],
        button_label: "Submit",
        on_finish: (data) => {
          const answer = speciesDict[data.response.bird_choice];
          data.correct = answer === species;
          data.species = species;
          data.selected = answer;
        },
      };

      const feedback = {
        type: jsPsychHtmlButtonResponse,
        stimulus: () => {
          const last = jsPsych.data.get().last(1).values()[0];
          return last.correct
            ? "<p>✅ Correct!</p>"
            : "<p>❌ Incorrect — please try again.</p>";
        },
        choices: ["Continue"],
      };

      return {
        timeline: [trial, feedback],
        loop_function: () => {
          const last = jsPsych.data.get().last(2).values()[0];
          return !last.correct;
        },
      };
    })
  );

  return quizzes;
}

// ─── Main Experiment Runner ──────────────────────────────────────────────────────
async function runExperiment() {
  const jsPsych = initJsPsych({
    on_finish: () => jsPsych.data.displayData(),
  });

  await loadTemplates();

  const welcome = await loadWelcome();
  const featuresIntro = await loadFeaturesIntro();
  const [speciesIntro, speciesExamples, speciesSummary] =
    await loadSpeciesIntro();
  const quizzes = await loadQuizzes(jsPsych);

  const timeline = [
    welcome,
    featuresIntro,
    speciesIntro,
    ...speciesExamples,
    speciesSummary,
    ...quizzes,
  ];

  jsPsych.run(timeline);
}

runExperiment();
