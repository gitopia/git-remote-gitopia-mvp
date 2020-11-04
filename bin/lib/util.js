import pkg from "cli-progress";
const { Bar, Presets } = pkg;

export const formatTime = (t, roundToMultipleOf) => {
  function round(input) {
    if (roundToMultipleOf) {
      return roundToMultipleOf * Math.round(input / roundToMultipleOf);
    } else {
      return input;
    }
  }
  if (t > 3600) {
    return Math.floor(t / 3600) + "h" + round((t % 3600) / 60) + "m";
  } else if (t > 60) {
    return Math.floor(t / 60) + "m" + round(t % 60) + "s";
  } else if (t > 10) {
    return round(t) + "s";
  } else {
    return t + "s";
  }
};

export const newProgressBar = () =>
  new Bar(
    {
      etaBuffer: 100,
      fps: 30,
      //@ts-ignore
      // The types for this library aren't up to date
      format: (options, params, payload) => {
        const percentage = Math.round(params.progress * 100) + "";
        // calculate elapsed time
        const elapsedTime = Math.round((Date.now() - params.startTime) / 1000);
        const elapsedTimef = formatTime(elapsedTime, 1);

        const bar =
          options.barCompleteString.substr(
            0,
            Math.round(params.progress * options.barsize)
          ) +
          options.barIncompleteString.substr(
            0,
            Math.round((1.0 - params.progress) * options.barsize)
          );

        return `${bar} ${params.value}/${params.total} ${percentage}% | ${elapsedTimef}`;
      },
    },
    Presets.shades_classic
  );
