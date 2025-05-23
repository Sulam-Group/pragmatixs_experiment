// ─── Constants & Cached Templates ───────────────────────────────────────────────
const endpoint =
  'https://script.google.com/macros/s/AKfycbxrifa9YVbUOMkJbc1OrP1eI-_0ch9Hp202eH9b3a-PELsEN0GmQYjR3gogkmdXKPsC/exec';
const key = '4S9#b8Q%drXyT*ps';

const speciesDict = {
  'Bird A': 'american_goldfinch',
  'Bird B': 'black_and_white_warbler',
  'Bird C': 'pileated_woodpecker',
  'Bird D': 'scarlet_tanager',
  'Bird E': 'wilson_warbler',
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

function getProlificInfo() {
  const params = new URLSearchParams(window.location.search);
  return {
    prolific_pid: params.get('PROLIFIC_PID'),
    study_id: params.get('STUDY_ID'),
    session_id: params.get('SESSION_ID'),
  };
}

async function postResults(data) {
  let attempt = 0;
  let maxRetries = 5;
  let delay = 1000;

  const payload = new URLSearchParams({
    secret: key,
    prolific_pid: data.prolific_pid,
    study_id: data.study_id,
    session_id: data.session_id,
    trials: JSON.stringify(data.trials),
  });

  data.secret = key;
  while (attempt <= 10) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: payload,
      });
      if (response.ok) {
        console.log('Data posted successfully');
        return;
      } else {
        console.warn('Failed to post data:', response.statusText);
      }
    } catch (err) {
      console.error('Error posting data:', err);
    }

    attempt++;
    if (attempt <= maxRetries) {
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

// ─── Template Loader ─────────────────────────────────────────────────────────────
async function loadTemplates() {
  const paths = {
    list: 'templates/list.html',
    manual: 'templates/manual.html',
    species: 'templates/species.html',
    trial: 'templates/trial.html',
    quiz: 'pages/quiz.html',
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
  const welcomeHTML = await loadHTML('pages/welcome.html');
  return {
    type: jsPsychInstructions,
    pages: [welcomeHTML],
    show_clickable_nav: true,
    data: { phase: 'welcome' },
  };
}

async function loadFeaturesIntro() {
  const staticPages = await Promise.all([
    loadHTML('pages/features/intro_1.html'),
    loadHTML('pages/features/intro_2.html'),
    loadHTML('pages/features/intro_3.html'),
  ]);

  const examples = ['coloration', 'patterns', 'shape_size'];
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
    data: { phase: 'features_intro' },
  };
}

async function loadSpeciesIntro() {
  const [introHTML, summaryTemplate] = await Promise.all([
    loadHTML('pages/species/intro.html'),
    loadHTML('pages/species/summary.html'),
  ]);

  const intro = {
    type: jsPsychInstructions,
    pages: [introHTML],
    show_clickable_nav: true,
    data: { phase: 'species_intro' },
  };

  const examples = speciesList.map(([id, species]) => ({
    type: jsPsychSurveyText,
    preamble: Mustache.render(TEMPLATES.species, { id, species }),
    questions: [
      {
        prompt: 'Type your one-sentence description of the bird here:',
        rows: 2,
        columns: 60,
        required: true,
      },
    ],
    data: { phase: 'spcies_examples', species },
  }));

  const summary = {
    type: jsPsychInstructions,
    pages: [
      Mustache.render(summaryTemplate, {
        manual_html: renderManual(true),
      }),
    ],
    show_clickable_nav: true,
    data: { phase: 'species_summary' },
  };

  return [intro, examples, summary];
}

async function loadQuizzes(jsPsych) {
  const quizzesList = shuffle(Object.values(speciesDict)).slice(0, 3);

  const quizzes = await Promise.all(
    quizzesList.map(async (species) => {
      const features = await loadJSON(`content/quiz/${species}.json`);

      const trial = {
        type: jsPsychSurveyMultiChoice,
        preamble: Mustache.render(TEMPLATES.quiz, {
          trial_html: renderTrialHTML(features),
        }),
        questions: [
          {
            prompt: 'What is the species of this bird?',
            name: 'bird_choice',
            options: Object.keys(speciesDict),
            required: true,
            horizontal: true,
          },
        ],
        button_label: 'Submit',
        data: { phase: 'quiz', species },
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
            ? '<p>✅ Correct!</p>'
            : '<p>❌ Incorrect — please try again.</p>';
        },
        data: { phase: 'quiz_feedback' },
        choices: ['Continue'],
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

async function loadTrials() {
  const [trialIntroHTML, trialPageTemplate, manifest] = await Promise.all([
    loadHTML('pages/trials/intro.html'),
    loadHTML('pages/trials/trial.html'),
    loadJSON('content/trials/manifest.json'),
  ]);

  const conditions = manifest.conditions;
  const samples = manifest.samples;
  const species = Object.keys(samples);

  const allTrialsData = await Promise.all(
    conditions.map(async (condition) => {
      const selectedSpecies = shuffle(species).slice(0, 4);
      const selectedSamples = selectedSpecies.map((species) => [
        species,
        shuffle(samples[species])[0],
      ]);
      return await Promise.all(
        selectedSamples.map(async ([species, sample]) => {
          const data = await loadJSON(
            `content/trials/${condition}/${species}/${sample}.json`
          );
          data.condition = condition;
          data.uid = sample;
          return data;
        })
      );
    })
  );

  const trialsIntro = {
    type: jsPsychInstructions,
    pages: [trialIntroHTML],
    show_clickable_nav: true,
    data: { phase: 'trials_intro' },
  };

  const trialsData = shuffle(allTrialsData.flat());
  const trials = trialsData.map((trialData, i) => ({
    type: jsPsychSurveyMultiChoice,
    preamble: Mustache.render(trialPageTemplate, {
      i: i + 1,
      total: trialsData.length,
      trial_html: renderTrialHTML(trialData.features),
    }),
    questions: [
      {
        prompt: 'What is the species of this bird?',
        name: 'bird_choice',
        options: Object.keys(speciesDict),
        required: true,
        horizontal: true,
      },
    ],
    button_label: 'Submit',
    data: {
      phase: 'trial',
      condition: trialData.condition,
      uid: trialData.uid,
      target: trialData.target,
    },
    on_finish: (data) => {
      data.answer = speciesDict[data.response.bird_choice];
    },
  }));

  return { timeline: [trialsIntro, ...trials] };
}

async function loadSurvey() {
  const completionHTML = await loadHTML('pages/completion.html');

  return {
    type: jsPsychSurveyMultiChoice,
    preamble: completionHTML,
    questions: [
      {
        prompt: 'What is your age group?',
        name: 'age',
        options: ['18-24', '25-34', '35-44', '45-54', '55+'],
        required: true,
      },
      {
        prompt: 'What is your self-identified gender?',
        name: 'gender',
        options: ['Female', 'Male', 'Non-binary', 'Prefer not to say'],
        required: true,
      },
      {
        prompt: 'What is your experience with bird identification?',
        name: 'experience',
        options: [
          'No experience',
          'Some experience (I birdwatch occasionally)',
          'Moderate experience (I birdwatch regularly)',
          'High experience (I am a professional birdwatcher)',
        ],
      },
    ],
    button_label: 'Continue',
    data: { phase: 'survey' },
  };
}

async function loadFeedback() {
  const completionHTML = await loadHTML('pages/completion.html');

  return {
    type: jsPsychSurveyText,
    preamble: completionHTML,
    questions: [
      {
        prompt: 'Do you have any comments or feedback about the experiment?',
        rows: 5,
        columns: 60,
        required: false,
        name: 'feedback',
      },
    ],
    button_label: 'Submit and return to Prolific',
    data: { phase: 'feedback' },
  };
}

// ─── Main Experiment Runner ──────────────────────────────────────────────────────
async function runExperiment() {
  const prolificInfo = getProlificInfo();

  const jsPsych = initJsPsych({
    on_finish: async () => {
      const button = document.querySelector('.jspsych-btn');
      if (button) button.disabled = true;

      const msg = document.createElement('p');
      msg.textContent = 'Saving your responses... please wait';
      msg.style.fontStyle = 'italic';
      document.querySelector('.jspsych-content').appendChild(msg);

      const data = jsPsych.data.get().json();

      await postResults({
        prolific_pid: prolificInfo.prolific_pid,
        study_id: prolificInfo.study_id,
        session_id: prolificInfo.session_id,
        trials: JSON.parse(data),
      });

      window.location.href =
        'https://app.prolific.com/submissions/complete?cc=CQYC6OLS';
    },
  });
  jsPsych.data.addProperties(prolificInfo);

  await loadTemplates();

  const welcome = await loadWelcome();
  const featuresIntro = await loadFeaturesIntro();
  const [speciesIntro, speciesExamples, speciesSummary] =
    await loadSpeciesIntro();
  const quizzes = await loadQuizzes(jsPsych);
  const trials = await loadTrials();
  const survey = await loadSurvey();
  const feedback = await loadFeedback();

  const timeline = [
    welcome,
    featuresIntro,
    speciesIntro,
    ...speciesExamples,
    speciesSummary,
    ...quizzes,
    trials,
    survey,
    feedback,
  ];

  jsPsych.run(timeline);
}

runExperiment();
