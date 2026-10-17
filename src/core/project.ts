/** Public package identity shared by the built settings page and manifest. */
import manifest from '../../package.json'

export const PROJECT = {
  title: manifest.piano.displayName,
  version: `v${manifest.version}`,
  releaseDate: manifest.piano.releaseDate,
  maintainer: manifest.author.name,
  repositoryUrl: manifest.homepage,
  issuesUrl: manifest.bugs.url,
  packageName: manifest.name,
  packageUrl: `https://www.npmjs.com/package/${manifest.name}`,
} as const
