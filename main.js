var app = require('choo')()
var html = require('choo/html')

var regl = require('regl')
var earcut = require('earcut')
var pnormals = require('polyline-normals')

var pclip = require('pclip')
var pclipOpts = { xy: require('pclip/xy'), geo: require('pclip/geo') }

app.use(function (state, emitter) {
  state.canvas = document.createElement('canvas')
  state.canvas.width = window.innerWidth
  state.canvas.height = window.innerHeight
  state.regl = regl({ canvas: state.canvas })
  window.addEventListener('resize', function () {
    state.canvas.width = window.innerWidth
    state.canvas.height = window.innerHeight
    emitter.emit('frame')
  })
})

app.use(function (state, emitter) {
  state.props = {}
  state.props.solid = [
    {
      positions: [],
      cells: [],
      color: [1,0,0,0.1]
    },
    {
      positions: [],
      cells: [],
      color: [0,0,1,0.1]
    },
    {
      positions: [],
      cells: [],
      color: [0.5,0,0.5,0.9]
    },
  ]
  state.props.line = [
    {
      positions: [],
      normals: [],
      color: [1,0,0,1],
      nOffset: 0,
    },
    {
      positions: [],
      normals: [],
      color: [0.5,0.5,1,1],
      nOffset: 0,
    },
    {
      positions: [],
      normals: [],
      color: [1,1,1,1],
      nOffset: 0,
    },
  ]
  state.draw = {}
  emitter.on('frame', function () {
    state.regl.poll()
    state.regl.clear({ color: [0,0,0,1], depth: true })
    state.draw.solid(state.props.solid.slice(0,2))
    state.draw.solid(state.props.solid[2])
    state.draw.line(state.props.line.slice(0,2))
    state.draw.line(state.props.line[2])
  })
  state.draw.solid = state.regl({
    frag: `
      precision highp float;
      uniform vec4 color;
      void main() {
        gl_FragColor = color;
      }
    `,
    vert: `
      precision highp float;
      attribute vec2 position;
      uniform vec4 viewbox;
      void main() {
        vec2 p = vec2(
          (position.x-viewbox[0])/(viewbox[2]-viewbox[0]),
          (position.y-viewbox[1])/(viewbox[3]-viewbox[1])
        )*2.0-1.0;
        gl_Position = vec4(p*0.8,0,1);
      }
    `,
    attributes: {
      position: state.regl.prop('positions'),
    },
    uniforms: {
      color: state.regl.prop('color'),
      viewbox: () => state.view.cartesian.viewbox,
    },
    elements: state.regl.prop('cells'),
    depth: { enable: false, mask: false },
    blend: {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' },
    },
  })
  var nOffset = [0,0]
  state.draw.line = state.regl({
    frag: `
      precision highp float;
      uniform vec4 color;
      void main() {
        gl_FragColor = color;
      }
    `,
    vert: `
      precision highp float;
      attribute vec2 position, normal;
      uniform vec4 viewbox;
      uniform vec2 nOffset;
      void main() {
        vec2 p = vec2(
          (position.x-viewbox[0])/(viewbox[2]-viewbox[0]),
          (position.y-viewbox[1])/(viewbox[3]-viewbox[1])
        )*2.0-1.0;
        gl_Position = vec4(p*0.8+normal*nOffset,0,1);
      }
    `,
    attributes: {
      position: state.regl.prop('positions'),
      normal: state.regl.prop('normals'),
    },
    uniforms: {
      color: state.regl.prop('color'),
      nOffset: (context,props) => {
        nOffset[0] = props.nOffset/window.innerWidth
        nOffset[1] = props.nOffset/window.innerHeight
        return nOffset
      },
      viewbox: () => state.view.cartesian.viewbox,
    },
    primitive: 'lines',
    depth: { enable: false, mask: false },
    blend: {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' },
    },
    count: (context, props) => props.positions.length/2,
  })
})

app.use(function (state, emitter) {
  //state.algorithms = ['pclip/xy', 'pclip/geo', 'martinez', 'polygon-clipping']
  state.algorithms = ['pclip/xy']
  state.methods = ['union','intersect','difference','exclude','divide']
  //state.views = ['globe','cylindrical','cartesian']
  state.views = ['cartesian']
  state.selected = {
    algorithm: 'pclip/xy',
    method: 'union',
    view: 'cartesian',
  }
  state.view = {}
  state.view.cartesian = {
    viewbox: [-5,-5,15,15],
  }
  emitter.on('set-algorithm', function (a) {
    state.selected.algorithm = a
    emitter.emit('update-hash')
    emitter.emit('render')
    emitter.emit('calculate')
  })
  emitter.on('set-method', function (m) {
    state.selected.method = m
    emitter.emit('update-hash')
    emitter.emit('render')
    emitter.emit('calculate')
  })
  emitter.on('set-view', function (v) {
    state.selected.view = v
    emitter.emit('update-hash')
    emitter.emit('render')
    emitter.emit('calculate')
  })

  state.data = {
    A: [[0,0],[5,8],[10,0]],
    B: [[5,4],[10,12],[10,4]],
  }

  emitter.on('update-hash', function () {
    location.hash = btoa(JSON.stringify({
      a: state.selected.algorithm,
      m: state.selected.method,
      v: state.selected.cartesian,
      A: state.data.A,
      B: state.data.B,
    }))
  })
  if (location.hash.length > 1) {
    var hdata = JSON.parse(atob(decodeURIComponent(location.hash.slice(1))))
    if (hdata.a) state.selected.algorithm = hdata.a
    if (hdata.m) state.selected.method = hdata.m
    if (hdata.v) state.selected.view = hdata.v
    if (hdata.A) state.data.A = hdata.A
    if (hdata.B) state.data.B = hdata.B
  }

  state.input = {
    A: JSON.stringify(state.data.A),
    B: JSON.stringify(state.data.B),
  }
  state.result = '[]'
  state.timer = null
  emitter.on('set-input', function (key, value) {
    state.input[key] = value
    if (!state.timer) {
      state.timer = setTimeout(function () {
        state.timer = null
        emitter.emit('calculate')
      }, 200)
    }
  })
  emitter.on('calculate', function () {
    var A = state.data.A = JSON.parse(state.input.A)
    var B = state.data.B = JSON.parse(state.input.B)
    var opts = null
    if (state.selected.algorithm === 'pclip/xy') opts = pclipOpts.xy
    if (state.selected.algorithm === 'pclip/geo') opts = pclipOpts.geo
    var C = pclip[state.selected.method](A, B, opts)
    var bbox = state.view.cartesian.viewbox = [Infinity,Infinity,-Infinity,-Infinity]
    var mA = toMulti(A), mB = toMulti(B)
    setSolid(state.props.solid[0], bbox, mA)
    setSolid(state.props.solid[1], bbox, mB)
    setSolid(state.props.solid[2], bbox, C)
    setLine(state.props.line[0], mA)
    setLine(state.props.line[1], mB)
    setLine(state.props.line[2], C)
    state.result = JSON.stringify(C)
    emitter.emit('update-hash')
    emitter.emit('render')
    emitter.emit('frame')
  })
  process.nextTick(function () {
    emitter.emit('calculate')
  })

  function setSolid(out, bbox, X) {
    out.positions = []
    out.cells = []
    for (var i = 0; i < X.length; i++) {
      var positions = [], holes = []
      for (var j = 0; j < X[i].length; j++) {
        if (j > 0) holes.push(positions.length/2)
        for (var k = 0; k < X[i][j].length; k++) {
          var x = X[i][j][k][0], y = X[i][j][k][1]
          positions.push(x, y)
          bbox[0] = Math.min(bbox[0],x)
          bbox[1] = Math.min(bbox[1],y)
          bbox[2] = Math.max(bbox[2],x)
          bbox[3] = Math.max(bbox[3],y)
        }
      }
      var cells = earcut(positions, holes)
      var k = out.positions.length/2
      out.positions = out.positions.concat(positions)
      for (var j = 0; j < cells.length; j++) {
        out.cells.push(cells[j]+k)
      }
    }
  }

  function setLine(out, X) {
    out.positions = []
    out.normals = []
    for (var i = 0; i < X.length; i++) {
      for (var j = 0; j < X[i].length; j++) {
        var l = X[i][j].length
        var normals = pnormals(X[i][j],true)
        for (var k = 0; k < l; k++) {
          var x0 = X[i][j][k][0], y0 = X[i][j][k][1]
          var x1 = X[i][j][(k+1)%l][0], y1 = X[i][j][(k+1)%l][1]
          out.positions.push(x0, y0, x1, y1)
          var nx = normals[k][0][0], ny = normals[k][0][1], nl = Math.sqrt(normals[k][1])
          out.normals.push(nx/nl,ny/nl,nx/nl,ny/nl)
        }
      }
    }
  }

  function toMulti(x) {
    var d = getDepth(x)
    if (d === 2) return [[x]]
    if (d === 3) return [x]
    return x
  }
  function getDepth(x) {
    var d = 0
    for (; Array.isArray(x); x = x[0]) d++
    return d
  }
})

app.route('*', function (state, emit) {
  return html`<body>
    <style>
      body {
        background-color: black;
        color: white;
      }
      body, button, textarea {
        font-family: monospace;
      }
      canvas {
        position: absolute;
        top: 0px;
        bottom: 0px;
        left: 0px;
        right: 0px;
        z-index: 1;
      }
      .options {
        display: inline-block;
        padding-right: 1em;
        z-index: 100;
      }
      .options button {
        margin-right: 0.5ex;
        margin-bottom: 0.5em;
        border: 1px solid white;
        border-radius: 2px;
        padding: 1ex;
      }
      .options button.selected {
        background-color: purple;
        color: white;
      }
      .buttons {
        position: relative;
        z-index: 100;
      }
      .inputs {
        position: absolute;
        bottom: 0px;
        left: 0px;
        right: 0px;
        z-index: 100;
      }
      .inputs textarea {
        width: calc(100% - 7ex);
        height: 10em;
        background-color: transparent;
        border: 1px solid white;
        color: white;
      }
      .inputs .input.A .label {
        background-color: red;
      }
      .inputs .input.B .label {
        background-color: blue;
      }
      .inputs .input.C .label {
        background-color: purple;
      }
      .inputs .label {
        width: 4ex;
        text-align: center;
        display: inline-block;
        vertical-align: top;
        padding-top: 1em;
        padding-bottom: 1em;
        margin-right: 1ex;
      }
    </style>
    ${state.canvas}
    <div class="buttons">
      <div class="options">
        ${state.algorithms.map(a => html`<button
          class=${state.selected.algorithm === a ? 'selected' : ''}
          onclick=${() => emit('set-algorithm', a)}
        >${a}</button>`)}
      </div>
      <div class="options">
        ${state.methods.map(m => html`<button
          class=${state.selected.method === m ? 'selected' : ''}
          onclick=${() => emit('set-method', m)}
        >${m}</button>`)}
      </div>
      <div class="options">
        ${state.views.map(v => html`<button
          class=${state.selected.view === v ? 'selected' : ''}
          onclick=${() => emit('set-view', v)}
        >${v}</button>`)}
      </div>
    </div>
    <div class="inputs">
      <div class="input A">
        <div class="label">A</div>
        <textarea oninput=${oninput('A')}>${state.input.A}</textarea>
      </div>
      <div class="input B">
        <div class="label">B</div>
        <textarea oninput=${oninput('B')}>${state.input.B}</textarea>
      </div>
      <div class="input C">
        <div class="label">C</div>
        <textarea oninput=${oninput('C')}>${state.result}</textarea>
      </div>
    </div>
  </body>`
  function oninput(key) {
    return function (ev) {
      emit('set-input', key, ev.target.value)
    }
  }
})

app.mount(document.body)
