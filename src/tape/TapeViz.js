'use strict';
var Tape = require('./Tape.js'),
    d3   = require('d3');
require('./tape.css');
var jsyaml = require('js-yaml');
var ace = require('ace-builds/src-min-noconflict');
const util = require('../util');

var nodeEditControls = window.document.getElementById('node-edit-controls');
var transitionEditControls = window.document.getElementById('transition-edit-controls');
var nodeLabel = window.document.getElementById('nodeLabel');
var startState = window.document.getElementById('startState');
var read = window.document.getElementById('read');
var write = window.document.getElementById('write');
var moveL = window.document.getElementById('moveL');
var moveR = window.document.getElementById('moveR');
var deleteNode = window.document.getElementById('deleteNode');
var deleteLink = window.document.getElementById('deleteLink');
var source = ace.edit(document.getElementById('editor-container'));
var cellWidth = 50;
var cellHeight = 50;

function initTapeCells(selection) {
  selection.attr('class', 'tape-cell');
  selection.append('rect')
      // the box outline is purely visual, so remove its data binding
      .datum(null)
      .attr({'width': cellWidth,
        'height': cellHeight});
  selection.append('text')
      .text(function (d) { return d; })
      .attr({'x': cellWidth/2, 'y': cellHeight/2 + 8});
  return selection;
}

function positionCells(selection, offset) {
  offset = (offset == null) ? 0 : offset;
  selection.attr('transform', function (d, i) {
    return 'translate(' + (-cellWidth+10 + cellWidth*(i+offset)) + ')';
  });
  return selection;
}

function repositionWrapper(wrapper) {
  wrapper.attr('transform', 'translate(0 10)')
    .transition()
      .duration(0)
    .select('.exiting')
      .remove();
}

// Tape visualization centered around the tape head.
function TapeViz(svg, lookaround, blank, input) {
  Tape.call(this, blank, input);

  Object.defineProperty(this, 'lookaround', {
    value: lookaround,
    writable: false,
    enumerable: true
  });
  Object.defineProperty(this, 'domNode', {
    value: svg,
    writable: false,
    enumerable: true
  });

  // width is before + head + after, trimming 2 off to show cut-off tape ends
  var width  = cellWidth * (lookaround+1+lookaround-2) + 2*10;
  var height = cellHeight + 2*10;
  svg.attr({
    'width': '95%',
    'viewBox': [0, 0, width, height].join(' ')
  });

  this.wrapper = svg.append('g')
      .attr('class', 'wrapper')
      .call(repositionWrapper);

  svg.append('rect')
      .attr({'id': 'tape-head',
        'width': (1+1/5) * cellWidth,
        'height': (1+1/5) * cellHeight,
        'x': -cellWidth+10/2 + cellWidth*lookaround,
        'y': 10/2
      });

  this.wrapper.selectAll('.tape-cell')
      .data(this.readRange(-lookaround, lookaround))
    .enter()
    .append('g')
      .call(initTapeCells)
      .call(positionCells)
  ;

  //when the tape is clicked, show the edit controls
  svg.on('dblclick', function () {
    console.log("tape doubleclicked");
    //disable all the form fields - messy...
    nodeLabel.disabled = true;
    nodeLabel.value = '';
    startState.disabled = true;
    startState.checked = false;
    deleteNode.disabled = true;
    read.disabled = true;
    read.value = '';
    write.disabled = true;
    write.value = '';
    moveL.disabled = true;
    moveR.disabled = true;
    deleteLink.disabled = true;
    transitionEditControls.setAttribute("style", "display: none");
    nodeEditControls.setAttribute("style", "display: flex");
    //grab the machine
    var machine = jsyaml.safeLoad(source.getValue());
    var controlsDiv = window.document.getElementById('tape-edit-controls');
    controlsDiv.setAttribute("style", "display: flex");
    var controlsInput = window.document.getElementById('tape-edit-input');
    controlsInput.value = machine['input'];
    var controlsBlank = window.document.getElementById('tape-edit-blank');
    controlsBlank.value = machine['blank'];
    var controlsSet = window.document.getElementById('tape-edit-set');
    controlsSet.addEventListener('click', function () {
      //change input
      machine['input'] = controlsInput.value;
      //change every read symbol that matches the blank symbol
      for (var node in machine.table) {
        for (var readSymbols in machine.table[node]){
          var newRead = [];
          var splitRead = readSymbols.split(",");
          for (var symbol of splitRead) {
            if (symbol === machine['blank']) symbol = controlsBlank.value;
            newRead.push(symbol);
          }
          if (!(readSymbols === newRead.join())){
             machine.table[node][newRead] = machine.table[node][readSymbols];
             delete machine.table[node][readSymbols];
          }
          if (machine.table[node][newRead].hasOwnProperty("write")) {
            if (machine.table[node][newRead]['write'] === machine['blank'])
              machine.table[node][newRead]['write'] = controlsBlank.value
          }
        }
      }
      //finally change blank symbol
      machine['blank'] = controlsBlank.value;
      //we're finished here
      source.setValue(jsyaml.safeDump(machine));
      util.setCookie('TMReload', 'tape changed');
    })
  });
}

TapeViz.prototype = Object.create(Tape.prototype);
TapeViz.prototype.constructor = TapeViz;

// IDEA: chain headLeft/Right to wait for write()?
TapeViz.prototype.write = function (symbol) {
  // don't animate if symbol stays the same
  if (Tape.prototype.read.call(this) === symbol) {
    return;
  }
  Tape.prototype.write.call(this, symbol);

  // remove leftover .exiting in case animation was interrupted
  this.wrapper.selectAll('.exiting').remove();

  d3.select(this.wrapper[0][0].childNodes[this.lookaround])
      .datum(symbol)
    .select('text')
      .attr('fill-opacity', '1')
      .attr('stroke-opacity', '1')
    .transition()
      .attr('fill-opacity', '0.4')
      .attr('stroke-opacity', '0.1')
    .transition()
      .text(function (d) { return d; })
      .attr('fill-opacity', '1')
      .attr('stroke-opacity', '1')
    .transition()
      .duration(0)
      .attr('fill-opacity', null)
      .attr('stroke-opacity', null)
    ;
};

function moveHead(wrapper, enter, exit, wOffset, cOffset) {
  // add to one end
  enter.call(initTapeCells);
  // remove from the other end
  exit.classed('exiting', true);
  // translate cells forward, and the wrapper backwards
  wrapper.selectAll('.tape-cell')
      .call(positionCells, cOffset);
  wrapper
      .attr('transform', 'translate(' + (wOffset*cellWidth).toString() + ' 10)')
    // animate wrapper returning to neutral position
    .transition()
      .call(repositionWrapper);
}

TapeViz.prototype.headRight = function () {
  Tape.prototype.headRight.call(this);
  // remove leftover .exiting in case animation was interrupted.
  // Important: call-by-value evaluates the selection argument(s) of 'moveHead' before
  // before entering the function, so exiting nodes have to be removed beforehand.
  this.wrapper.selectAll('.exiting').remove();
  moveHead(this.wrapper,
    // add to right end
    this.wrapper.append('g')
        .datum(this.readOffset(this.lookaround)),
    // remove from left end
    this.wrapper.select('.tape-cell'),
    1, -1);
};

TapeViz.prototype.headLeft = function () {
  Tape.prototype.headLeft.call(this);
  this.wrapper.selectAll('.exiting').remove();
  moveHead(this.wrapper,
    this.wrapper.insert('g', ':first-child')
        .datum(this.readOffset(-this.lookaround)),
    this.wrapper.select('.wrapper > .tape-cell:last-of-type'),
    -1, 0);
};

module.exports = TapeViz;
