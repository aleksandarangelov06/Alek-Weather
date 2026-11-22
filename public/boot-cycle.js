// Random scene order for the weather animation (the .boot-stage in index.html):
// the boot screen's, and every in-app loading screen's copy of it.
//
// index.html's CSS plays the scenes in a fixed order on a 3.5s loop; that stays
// as the fallback. This replaces it with a shuffled sequence: four rounds of
// the five scenes, each round in a fresh random order, so every scene comes up
// equally often, never twice running (not even where the sequence loops back
// to its start), and the order doesn't visibly repeat for 14 seconds. Each
// showing gets a new sequence.
//
// It is played with the Web Animations API rather than by swapping classes on a
// timer, so the compositor runs it exactly as it ran the CSS: no scene change
// waits on the main thread, which is busy for most of a launch and a refresh.
// Each slide gets one keyframe track spanning the whole sequence, with a pop
// at each of its turns, so the whole thing is set up once and never touched.
//
// Loaded as a plain script straight after the boot screen's markup, before the
// first paint, and runs on that stage there. It also leaves the function on
// window (alekBootCycle) for the app to run on its loading screen's copy (see
// startBootCycle in src/utils/bootStage.js).
(function () {
  var BEAT = 700      // ms each scene has the stage
  var POPPED = 210    // ms into its turn the pop has settled
  var LEAVING = 595   // ms into its turn it starts to go
  var GONE = 735      // ms into its turn it has gone (overlapping the next pop)
  var ROUNDS = 4
  var POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
  var OUT = 'cubic-bezier(0.4, 0, 1, 1)'

  function shuffled(count) {
    var a = []
    for (var i = 0; i < count; i++) a.push(i)
    for (var j = count - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1))
      var t = a[j]; a[j] = a[k]; a[k] = t
    }
    return a
  }

  function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t }

  // Rounds of distinct scenes, so no scene repeats inside one. Where two meet,
  // and where the end wraps round to the start, a repeat is fixed by swapping
  // within the round, which keeps every round a full set.
  function sequence(count) {
    var seq = []
    for (var r = 0; r < ROUNDS; r++) {
      var round = shuffled(count)
      if (seq.length && round[0] === seq[seq.length - 1]) swap(round, 0, 1)
      seq = seq.concat(round)
    }
    var n = seq.length
    if (seq[n - 1] === seq[0]) swap(seq, n - 1, n - 2)
    return seq
  }

  function start(stage) {
    if (!stage || typeof stage.animate !== 'function') return false
    var slides = stage.querySelectorAll('.boot-slide')
    if (slides.length < 3) return false

    var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    // Reduced motion: the same turns, as plain cross-fades.
    var frame = function (offset, opacity, scale, easing) {
      var f = { offset: offset, opacity: opacity, easing: easing || 'linear' }
      if (!still) f.transform = 'scale(' + scale + ')'
      return f
    }

    var seq = sequence(slides.length)
    var total = seq.length * BEAT
    for (var s = 0; s < slides.length; s++) {
      var frames = [frame(0, 0, 0.6)]
      for (var i = 0; i < seq.length; i++) {
        if (seq[i] !== s) continue
        var t = i * BEAT
        frames.push(frame(t / total, 0, 0.4, still ? 'ease-out' : POP))
        frames.push(frame((t + POPPED) / total, 1, 1))
        frames.push(frame((t + LEAVING) / total, 1, 1, still ? 'ease-in' : OUT))
        frames.push(frame(Math.min(t + GONE, total) / total, 0, 0.6))
      }
      frames.push(frame(1, 0, 0.6))
      slides[s].style.animation = 'none'
      slides[s].animate(frames, { duration: total, iterations: Infinity })
    }
    return true
  }

  window.alekBootCycle = start
  // In the APK the launch screen is native and #boot only a blank cover under
  // it (data-native-boot, see boot-sky.js): nothing of its own to play.
  if (!document.documentElement.hasAttribute('data-native-boot')) start(document.querySelector('#boot .boot-stage'))
})()
