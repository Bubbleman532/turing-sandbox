'use strict';

//TODO (stretchiest goal) preserve the lower comments in code if possible (might be possible)

var isBrowserIEorEdge = require('../util').isBrowserIEorEdge;
var d3 = require('d3');
var jsyaml = require('js-yaml');
var ace = require('ace-builds/src-min-noconflict');
var _ = require('lodash/fp');
var assign = require('lodash').assign; // need mutable assign()

//diagram direct edit form fields
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

// *** Arrays as vectors ***

// Add vectors.
// Note: dimensions are not checked. Missing dimensions become NaN.
function addV(array1, array2) {
  return array1.map(function (x, i) { return x + array2[i]; });
}

function negateV(array) {
  return array.map(function (x) { return -x; });
}

function subtractV(array1, array2) {
  return addV(array1, negateV(array2));
}

// Scale the vector by a scalar.
function multiplyV(array, scalar) {
  return array.map(function (x) { return scalar*x; });
}

// Vector norm, squared
function normSqV(array) {
  function sq(x) { return x*x; }
  function add(x, y) { return x + y; }
  return array.map(sq).reduce(add, 0);
}

// Vector norm
function normV(array) { return Math.sqrt(normSqV(array)); }

// Return a copy of the vector rescaled as a unit vector (norm = 1).
function unitV(array) {
  var n = normV(array);
  return array.map(function (x) { return x / n; });
}

// *** 2D Vectors ***
function angleV(array) {
  var x = array[0], y = array[1];
  return Math.atan2(y, x);
}

function vectorFromLengthAngle(length, angle) {
  return [Math.cos(angle) * length, Math.sin(angle) * length];
}

// *** Utilities ***

//mouse event variables need to be global for the editing to work
var selectedNode = null;
var selectedLink = null;
var mousedownLink = null;
var mousedownNode = null;
var mouseupNode = null;
var mouseoverNode = false;
var mouseoverLink = false;
var mouseOverSameNode = false;
var mouseOver = 0;
var lastKeyDown = -1;

function resetMouseVars() {
  mousedownNode = null;
  mouseupNode = null;
  mousedownLink = null;
  mouseOverSameNode = false;
}

//Disable the edit controllers, reset EVERYTHING to foolproof this

function disableNodeEditing() {
  nodeLabel.disabled = true;
  nodeLabel.value = '';
  startState.disabled = true;
  startState.checked = false;
  deleteNode.disabled = true;
  //remove the selected-node class from node
  if(selectedNode) d3.select(selectedNode.domNode).classed('selected-node', false);
  selectedNode = null;
}

function disableLinkEditing() {
  read.disabled = true;
  read.value = '';
  write.disabled = true;
  write.value = '';
  moveL.disabled = true;
  moveR.disabled = true;
  deleteLink.disabled = true;
  if(selectedLink) d3.select(selectedLink.domNode).classed('selected-edge', false);
  selectedLink = null;
}
function disableEditing(){
  disableNodeEditing();
  disableLinkEditing();
  transitionEditControls.setAttribute("style", "display: none");
  nodeEditControls.setAttribute("style", "display: flex");
}

//throw the error div on screen if the user does something that will invalidate the machine configuration
function throwMachineError(errorInfo) {
  var alerts = d3.select(window.document.getElementById("editor-alerts-container"));

  alerts.selectAll('.alert').remove();

  alerts.append('div')
    .attr('class', 'alert alert-danger')
    .attr('role', 'alert')
    .append('span').text(errorInfo);
}

// Count the directed edges that start at a given node and end at another.
// Important: each node must have a unique .index property.
// Example usage:
// var counts = new EdgeCounter(edges);
// var edgesFrom2To5 = counts.numEdgesFromTo(2,5);
// var edgesFrom5to2 = counts.numEdgesFromTo(5,2);
function EdgeCounter(edges) {
  edges.forEach(function (e) {
    var key = e.source.index +','+ e.target.index;
    this[key] = (this[key] || 0) + 1;
  }, this);
}

EdgeCounter.prototype.numEdgesFromTo = function (src, target) {
  return this[String(src)+','+String(target)] || 0;
};

var EdgeShape = Object.freeze({
  loop: {},     // self-loop: a->a
  arc: {},      // curved arc: a->b when b->a exists
  straight: {}  // straight edge: a->b when b->a does not exist
});

EdgeCounter.prototype.shapeForEdge = function (e) {
  if (e.target.index === e.source.index) {
    return EdgeShape.loop;
  } else if (this.numEdgesFromTo(e.target.index, e.source.index)) {
    // has returning edge => arc
    return EdgeShape.arc;
  } else {
    return EdgeShape.straight;
  }
};

// create a function that will compute an edge's SVG 'd' attribute.
function edgePathFor(nodeRadius, shape, d) {
  // case: self-loop
  var loopEndOffset, loopArc;
  if (shape === EdgeShape.loop) {
    // start at the top (90°), end slightly above the right (15°)
    loopEndOffset = vectorFromLengthAngle(nodeRadius, -15 * Math.PI/180);
    loopArc = ' a 19,27 45 1,1 ' + loopEndOffset[0] + ',' + (loopEndOffset[1]+nodeRadius);
    return function () {
      var x1 = d.source.x,
          y1 = d.source.y;
      return 'M ' + x1 + ',' + (y1-nodeRadius) + loopArc;
    };
  }
  // case: between nodes
  if (shape === EdgeShape.arc) {
    // sub-case: arc
    return function () {
      // note: p1 & p2 have to be delayed, to access x/y at the time of the call
      var p1 = [d.source.x, d.source.y];
      var p2 = [d.target.x, d.target.y];
      var offset = subtractV(p2, p1);
      var radius = 6/5*normV(offset);
      // Note: SVG's y-axis is flipped, so vector angles are negative
      // relative to standard coordinates (as used in Math.atan2).
      // Proof: angle(r <cos ϴ, -sin ϴ>) = angle(r <cos -ϴ, sin -ϴ>) = -ϴ.
      var angle = angleV(offset);
      var sep = -Math.PI/2/2; // 90° separation, half on each side
      var source = addV(p1, vectorFromLengthAngle(nodeRadius, angle+sep));
      var target = addV(p2, vectorFromLengthAngle(nodeRadius, angle+Math.PI-sep));
      // IDEA: consider http://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
      return (p1[0] <= p2[0])
        ? 'M '+source[0]+' '+source[1]+' A '+radius+' '+radius+' 0 0,1 '+target[0]+' '+target[1]
        : 'M '+target[0]+' '+target[1]+' A '+radius+' '+radius+' 0 0,0 '+source[0]+' '+source[1];
    };
  } else if (shape === EdgeShape.straight) {
    return function () {
      // sub-case: straight line
      var p1 = [d.source.x, d.source.y];
      var p2 = [d.target.x, d.target.y];
      var offset = subtractV(p2, p1);
      // avoid spurious errors when bounding causes node centers to coincide
      if (offset[0] === 0 && offset[1] === 0) { return null; }

      var target = subtractV(p2, multiplyV(unitV(offset), nodeRadius));
      return 'M '+p1[0]+' '+p1[1]+' L '+ target[0] +' '+ target[1];
    };
  }
}

function rectCenter(svgrect) {
  return {x: svgrect.x + svgrect.width/2,
    y: svgrect.y + svgrect.height/2};
}

function identity(x) { return x; }
function noop() {}

function limitRange(min, max, value) {
  return Math.max(min, Math.min(value, max));
}

// IE padding hack so that SVG resizes properly.
// This works across browsers but we only need it for IE.
var appendSVGTo = !isBrowserIEorEdge
  ? function (div) { return div.append('svg'); }
  : function (div, hwRatio) {
    return div
      .append('div')
        .style({
          width: '100%',
          height: '0',
          'padding-bottom': (100 * hwRatio) + '%',
          position: 'relative'
        })
      .append('svg')
        .style({
          position: 'absolute',
          top: '0',
          left: '0'
        });
  };

// *** D3 diagram ***
require('./StateViz.css');
const util = require('../util');
const parser = require('../parser');

// type LayoutNode = {label: string};
// type StateMap = {[state: string]: LayoutNode};

/**
 * Create a state diagram inside an SVG.
 * Each vertex/edge (node/link) object is also annotated with @.domNode@
 * corresponding to its SVG element.
 *
 * Note: currently, element IDs (e.g. for textPath) will collide if multiple
 * diagrams are on the same document (HTML page).
 * @param  {D3Selection}      container     Container to add the SVG to.
 * @param  {[LayoutNode] | StateMap} nodes  Parameter to D3's force.nodes.
 *   Important: passing a StateMap is recommended when using setPositionTable.
 *   Passing an array will key the state nodes by array index.
 * @param  {[LayoutEdge]}     linkArray     Parameter to D3's force.links.
 */
function StateViz(container, nodes, linkArray) {
  /* References:
    [Sticky Force Layout](http://bl.ocks.org/mbostock/3750558) demonstrates
    drag to position and double-click to release.

    [Graph with labeled edges](http://bl.ocks.org/jhb/5955887) demonstrates
    arrow edges with auto-rotated labels.

    [Directed Graph Editor](https://gist.github.com/rkirsling/5001347) demonstrates
    a node graph sandbox with dragging for both moving nodes and adding edges.
  */

  /* eslint-disable no-invalid-this */ // eslint is not familiar with D3
  var w = 800;
  var h = 500;
  var linkDistance = 140;
  var nodeRadius = 20;

  var colors = d3.scale.category10();

  var svg = appendSVGTo(container, h/w);
  svg.attr({
    'viewBox': [0, 0, w, h].join(' '),
    'version': '1.1',
    ':xmlns': 'http://www.w3.org/2000/svg',
    ':xmlns:xlink': 'http://www.w3.org/1999/xlink'
  });

  svg.on('contextmenu', function () { d3.event.preventDefault(); });

  // Force Layout

  // drag event handlers
  function dragstart(d) {
    d.fixed = true; //stays where you put it
    svg.transition()
      .style('box-shadow', 'inset 0 0 2px gold'); //yellow around canvas
  }
  function dragend() {
    svg.transition()
      .style('box-shadow', null); //yellow around canvas
  }

  var dragLine = svg.append('path')
    .attr('class', 'link dragline hidden')
    .attr('d', 'M0,0L0,0');

  //this function used to release the node if it was double-clicked on
  /*function releasenode(d) {
    d.fixed = false;
    force.resume(); //happens on double click rn
  }*/

  // set up force layout
  var nodeArray = nodes instanceof Array ? nodes : _.values(nodes);
  this.__stateMap = nodes;

  var force = d3.layout.force()
      .nodes(nodeArray)
      .links(linkArray)
      .size([w,h])
      .linkDistance([linkDistance])
      .charge([-500])
      .theta(0.1)
      .gravity(0.05)
      .start();

  var drag = force.drag()
      .on('dragstart', dragstart)
      .on('dragend', dragend);

  // Edges
  var edgeCounter = new EdgeCounter(linkArray);

  var edgeselection = svg.selectAll('.edgepath')
    .data(linkArray)
    .enter();

  var edgegroups = edgeselection.append('g');

  var labelAbove = function (d, i) { return String(-1.1*(i+1)) + 'em'; };
  var labelBelow = function (d, i) { return String(0.6+ 1.1*(i+1)) + 'em'; };

  edgegroups.each(function (edgeD, edgeIndex) {
    var group = d3.select(this);
    var edgepath = group
      .append('path')
        .attr({'class': 'edgepath transition',
          'id': 'edgepath'+edgeIndex })
        .each(function (d) { d.domNode = this; })
        .on('mousedown', (d) => {
          if (d3.event.ctrlKey) return;

          // select link
          mousedownLink = d;
          //remove the edgepath.selected-edge class to the node if one already selected
          if(selectedLink) d3.select(selectedLink.domNode).classed('selected-edge', false);
          selectedLink = mousedownLink;
          //remove the selected-node class from node
          if(selectedNode) d3.select(selectedNode.domNode).classed('selected-node', false);
          selectedNode = null;

          //add the edgepath.selected-edge class to the node
          d3.select(selectedLink.domNode).classed('selected-edge', true);

          //re-enable the editing
          read.disabled = false;
          write.disabled = false;
          moveL.disabled = false;
          moveR.disabled = false;
          deleteLink.disabled = false;

          var boxContents = selectedLink.labels[0].split("→");
          read.value = boxContents[0];
          if(boxContents[1].includes(",")){
            var splitTransition = boxContents[1].split(",");
            write.value = splitTransition[0];
            moveL.disabled = (splitTransition[1] === "L");
            moveL.classList.toggle('btn-secondary', !(splitTransition[1] === "L"));
            moveL.classList.toggle('btn-success', (splitTransition[1] === "L"));
            moveR.disabled = !(splitTransition[1] === "L");
            moveR.classList.toggle('btn-success', !(splitTransition[1] === "L"));
            moveR.classList.toggle('btn-secondary', (splitTransition[1] === "L"));
          } else {
            write.value = "";
            moveL.disabled = (boxContents[1] === "L");
            moveL.classList.toggle('btn-secondary', !(boxContents[1] === "L"))
            moveL.classList.toggle('btn-success', (boxContents[1] === "L"))
            moveR.disabled = !(boxContents[1] === "L");
            moveR.classList.toggle('btn-success', !(boxContents[1] === "L"))
            moveR.classList.toggle('btn-secondary', (boxContents[1] === "L"))
          }

          disableNodeEditing();
          nodeEditControls.setAttribute("style", "display: none");
          transitionEditControls.setAttribute("style", "display: flex");

          console.log(selectedLink);

          force.resume();
        })
        .on('mouseover', function () {mouseoverLink = true;})
        .on('mouseout', function () {mouseoverLink = false;})

    var labels = group.selectAll('.edgelabel')
      .data(edgeD.labels).enter()
      .append('text')
        .attr('class', 'edgelabel');
    labels.append('textPath')
        .attr('xlink:href', function () { return '#edgepath'+edgeIndex; })
        .attr('startOffset', '50%')
        .text(identity);
    /* To reduce JS computation, label positioning varies by edge shape:
        * Straight edges can use a fixed 'dy' value.
        * Loops cannot use 'dy' since it increases letter spacing
          as labels get farther from the path. Instead, since a loop's shape
          is fixed, it allows a fixed translate 'transform'.
        * Arcs are bent and their shape is not fixed, so neither 'dy'
          nor 'transform' can be constant.
          Fortunately the curvature is slight enough that a fixed 'dy'
          looks good enough without resorting to dynamic translations.
    */
    var shape = edgeCounter.shapeForEdge(edgeD);
    edgeD.getPath = edgePathFor(nodeRadius, shape, edgeD);
    switch (shape) {
      case EdgeShape.straight:
        labels.attr('dy', labelAbove);
        edgeD.refreshLabels = function () {
          // flip edge labels that are upside-down
          labels.attr('transform', function () {
            if (edgeD.target.x < edgeD.source.x) {
              var c = rectCenter(this.getBBox());
              return 'rotate(180 '+c.x+' '+c.y+')';
            } else {
              return null;
            }
          });
        };
        break;
      case EdgeShape.arc:
        var isFlipped;
        edgeD.refreshLabels = function () {
          var shouldFlip = edgeD.target.x < edgeD.source.x;
          if (shouldFlip !== isFlipped) {
            edgepath.classed('reversed-arc', shouldFlip);
            labels.attr('dy', shouldFlip ? labelBelow : labelAbove);
            isFlipped = shouldFlip;
          }
        };
        break;
      case EdgeShape.loop:
        labels.attr('transform', function (d, i) {
          return 'translate(' + String(8*(i+1)) + ' ' + String(-8*(i+1)) + ')';
        });
        edgeD.refreshLabels = noop;
        break;
    }
    //whole section above is just about the shape of the node arrows, probably don't touch
  });
  var edgepaths = edgegroups.selectAll('.edgepath');

  // Nodes
  // note: nodes are added after edges so as to paint over excess edge lines
  var nodeSelection = svg.selectAll('.node')
    .data(nodeArray)
    .enter();

  var nodecircles = nodeSelection
    .append('circle')
      .attr('class', 'node')
      .attr('r', nodeRadius)
      .style('fill', function (d,i) { return colors(i); })
      // .style('fill', function (d,i) {
      //   if (d === selectedNode) {
      //     return d3.rgb(colors(i).brighter().toString());
      //   } else return colors(i);
      //  })
      .each(function (d) { d.domNode = this; })
      .call(drag)
      .on('mousedown', function (d) {
        mousedownNode = d;
        if (!d3.event.ctrlKey) {

          // select node
          if (mousedownNode === selectedNode) {
            return;
          } else {
            //remove the selected-node class from node if one already selected
            if(selectedNode) d3.select(selectedNode.domNode).classed('selected-node', false);
            selectedNode = mousedownNode;

            // add selected-node class to the node
            d3.select(selectedNode.domNode).classed('selected-node', true);
            //re-enable the editing
            nodeLabel.disabled = false;
            deleteNode.disabled = false;

            var checkStartState = function () {
              var machine = jsyaml.safeLoad(source.getValue());
              if (machine['start state'] === selectedNode.label) {
                startState.disabled = true;
                return true;
              } else {
                startState.disabled = false;
                return false;
              }
            }

            var isStartState = checkStartState();

            nodeLabel.value = selectedNode.label;
            startState.checked = isStartState;
          }
          //remove the edgepath.selected-edge class from the node
          if(selectedLink) d3.select(selectedLink.domNode).classed('selected-edge', false);
          selectedLink = null;
          disableLinkEditing();
          transitionEditControls.setAttribute("style", "display: none");
          nodeEditControls.setAttribute("style", "display: flex");

          console.log(selectedNode);

        } else {
          //start dragline
          dragLine
            .classed('hidden', false)
            .attr('d', 'M' + mousedownNode.x + ',' + mousedownNode.y + 'L' + mousedownNode.x + ',' + mousedownNode.y);
        }
        force.resume();
      })
      .on('mouseover', function (d) {
        mouseoverNode = true;

        if (!mousedownNode) return;

        if(d === mousedownNode){
          mouseOverSameNode = true;
        }
      })
      .on('mouseout', function () {
        mouseoverNode = false;

        if (!mousedownNode) return;

        if (mouseOverSameNode) mouseOverSameNode = false;
      })
      .on('mouseup', function (d) {
        if (!mousedownNode) return;

        // needed by FF
        dragLine
          .classed('hidden', true)
          .style('marker-end', '');

        mouseupNode = d;

        if (lastKeyDown === 17) {
          // add link to graph (update if exists)
          var machine = jsyaml.safeLoad(source.getValue());
          machine.table[mousedownNode.label]['*'] = {L: mouseupNode.label};
          source.setValue(jsyaml.safeDump(machine));
          util.setCookie('TMReload', 'new link');
          disableEditing();
        }

        force.resume();
      });

  var nodelabels = nodeSelection
   .append('text')
     .attr('class', 'nodelabel')
     .attr('dy', '0.25em') /* dy doesn't work in CSS */
     .text(function (d) { return d.label; });

  // Arrowheads
  var svgdefs = svg.append('defs');
  svgdefs.selectAll('marker')
      .data(['arrowhead', 'active-arrowhead', 'reversed-arrowhead', 'reversed-active-arrowhead'])
    .enter().append('marker')
      .attr({'id': function (d) { return d; },
        'viewBox':'0 -5 10 10',
        'refX': function (d) {
          return (d.lastIndexOf('reversed-', 0) === 0) ? 0 : 10;
        },
        'orient':'auto',
        'markerWidth':3,
        'markerHeight':3
      })
    .append('path')
      .attr('d', 'M 0 -5 L 10 0 L 0 5 Z')
      .attr('transform', function (d) {
        return (d.lastIndexOf('reversed-', 0) === 0) ? 'rotate(180 5 0)' : null;
      });

  //not sure why i cant move this into the css but we ball
  var svgCSS =
    '.edgepath {' +
    '  marker-end: url(#arrowhead);' +
    '}' +
    '.edgepath.active-edge {' +
    '  marker-end: url(#active-arrowhead);' +
    '}' +
    '.edgepath.reversed-arc {' +
    '  marker-start: url(#reversed-arrowhead);' +
    '  marker-end: none;' +
    '}' +
    '.edgepath.active-edge.reversed-arc {' +
    '  marker-start: url(#reversed-active-arrowhead);' +
    '  marker-end: none;' +
    '}';
  svg.append('style').each(function () {
    if (this.styleSheet) {
      this.styleSheet.cssText = svgCSS;
    } else {
      this.textContent = svgCSS;
    }
  })

  // Force Layout Update
  force.on('tick', function () {
    // Keep coordinates in bounds. http://bl.ocks.org/mbostock/1129492
    // NB. Bounding can cause node centers to coincide, especially at corners.
    nodecircles.attr({cx: function (d) { return d.x = limitRange(nodeRadius, w - nodeRadius, d.x); },
      cy: function (d) { return d.y = limitRange(nodeRadius, h - nodeRadius, d.y); }
    });

    nodelabels.attr('x', function (d) { return d.x; })
              .attr('y', function (d) { return d.y; });

    edgepaths.attr('d', function (d) { return d.getPath(); });

    edgegroups.each(function (d) { d.refreshLabels(); });

    // Conserve CPU when layout is fully fixed
    if (nodeArray.every(function (d) { return d.fixed; })) {
      force.stop();
    }
  });
  this.force = force;

  //in this section begin the functions that enable the visual editing functionality
  //these are going to be pretty hacky so that they work, both because this is written in quite an
  //old version of javascript without classes and that I have very little experience working in this language
  //This entire codebase probably needs a rewrite, but I don't have the time, energy or motivation to do this

  if (lastKeyDown === 17) {
    nodecircles.on('.drag', null)
      .classed('node', false);
  }

  //add a node
  svg.on('dblclick', function () {

    if (d3.event.ctrlKey || mouseoverNode || mouseoverLink) return;
    //var source = controller.editor;
    var machine = jsyaml.safeLoad(source.getValue());
    //node name increments
    var newNodeIndex = (_.keys(machine.table).length + 1);
    var newNodeName;
    //check if counted node already exists and then add 1 (for all possible nodes)
    //yes this doesnt fill holes but its the simplest way to deal with this that I can think of
    for (var node in machine.table) {
      newNodeName = "State" + newNodeIndex.toString();
      if (machine.table.hasOwnProperty(newNodeName))
        newNodeIndex++;
    }
    machine.table[newNodeName] = {};
    source.setValue(jsyaml.safeDump(machine));
    disableEditing();
    nodeLabel.value = '';
    util.setCookie('TMReload', 'node');
  });

  //deselect node
  svg.on('mousedown', function () {
    if (mousedownNode || mousedownLink) return;
    //reset the containers and disable them?
    if (selectedNode || selectedLink) {
      disableEditing();
      resetMouseVars();
      util.setCookie('TMReload', 'reload');
    }
  });

  //drag a node or link a transition
  svg.on('mousemove', function () {
    if (!mousedownNode) return;

    // update drag line
    if(mouseOverSameNode) {
      dragLine.attr('d', function () {
        var loopEndOffset, loopArc;
        // start at the top (90°), end slightly above the right (15°)
        loopEndOffset = vectorFromLengthAngle(nodeRadius, -15 * Math.PI/180);
        loopArc = ' a 19,27 45 1,1 ' + loopEndOffset[0] + ',' + (loopEndOffset[1]+nodeRadius);
        var x1 = mousedownNode.x,
            y1 = mousedownNode.y;
        return 'M ' + x1 + ',' + (y1-nodeRadius) + loopArc;
        })
    } else dragLine.attr('d', 'M' + mousedownNode.x + ',' + mousedownNode.y + 'L' + d3.mouse(this)[0] + ',' + d3.mouse(this)[1]);
  });

  //finish a drag/transition
  svg.on('mouseup', function () {
    if (mousedownNode) {
      // hide drag line
      dragLine
        .classed('hidden', true)
        .style('marker-end', '');
    }

    // clear mouse event vars
    resetMouseVars();
  });

  svg.on('mouseenter', function () {
    mouseOver = 1;
    })
    .on('mouseleave', function () {
       mouseOver = 0;
    });

  d3.select(window)
    .on('keydown', function () {

      if (lastKeyDown !== -1) return;
      lastKeyDown = d3.event.keyCode;

      // ctrl
      if (d3.event.keyCode === 17) {
        nodecircles.on('.drag', null)
          .classed('node', false);
        return;
      }

      if (!selectedNode && !selectedLink) return;
      if (!mouseOver) return;
      switch (d3.event.keyCode) {
        //delete
        case 46: // delete
          if (selectedNode) {
            //delete the selected node
            //get machine code
            if(!startState.checked) {
              var machine = jsyaml.safeLoad(source.getValue());
              //delete every transition with the same name as the node being deleted
              delete machine.table[selectedNode['label']];
              for (var node in machine.table) {
                for (var read in machine.table[node]) {
                  for (var i in machine.table[node][read]) {
                    if(i === "L" | i === "R") {
                      if (machine.table[node][read][i] === selectedNode['label'])
                        delete machine.table[node][read];
                    }
                  }
                }
              }
              source.setValue(jsyaml.safeDump(machine));
              disableEditing();
              util.setCookie('TMReload', 'deleted a node');
            } else {
              //don't let the user delete the start state
              throwMachineError("Change the start state before trying to delete this node");
            }
          } else if (selectedLink) {
            //delete the selected transition
            //grab the machine
            var machine = jsyaml.safeLoad(source.getValue());
            delete machine['table'][selectedLink.source['label']][read.value];
            //we're finished here
            source.setValue(jsyaml.safeDump(machine));
            disableEditing();
            util.setCookie('TMReload', 'delete link');
          }
          //reload the simulation
          break;

          //TODO (stretch goal) add undo and redo functions - an array in util.js
      }
    })
    .on('keyup', function () {
      lastKeyDown = -1;

      if (d3.event.keyCode === 17) {
        nodecircles.call(drag)
          .classed('node', true);
      }
    })

  //preserve selected node if necessary
  if(nodeLabel.value){
    console.log('node was just changed');
    //LORD KNOWS HOW THIS WORKS
    var preservedNode = nodecircles.filter(function(d) { return d.label === nodeLabel.value })[0];
    selectedNode = preservedNode[0].__data__;
    d3.select(selectedNode.domNode).classed('selected-node', true);
    console.log(selectedNode);
  } else if (read.value) {
    console.log('transition was just changed');
    //I STILL do not know how to traverse d3 objects using efficient code so this will fucking do
    var preservedLabel = read.value + "→" + (write.value ? write.value + "," : "") + (moveL.disabled ? "L" : "R");
    var preservedTransition = edgeselection[0].filter(function(d) {
      return d.__data__['labels'][0] === preservedLabel;
    });
    var tempTransition = preservedTransition.filter(function (d) {
      var tempObj = d.__data__;
      return (tempObj.source['label'] === selectedLink.source.label && tempObj.target['label'] === selectedLink.target.label);
    })[0];
    selectedLink = tempTransition.__data__;
    d3.select(selectedLink.domNode).classed('selected-edge', true);
    console.log(selectedLink);
  }
  /* eslint-enable no-invalid-this */
}

//edit controls for good enjoyable editing
nodeLabel.addEventListener('focusout', function() {
  // first make sure the node name actually changed
  if (!(selectedNode['label'] === nodeLabel.value)) {
    // get machine code
    var machine = jsyaml.safeLoad(source.getValue());
    // does a node with this new name exist already?
    if (!(machine.table[nodeLabel.value] === undefined)) {
      // a node exists already
      throwMachineError("A node with that name exists already.");
    } else {
      // we're changing the name of the node
      machine.table[nodeLabel.value] = machine.table[selectedNode['label']];
      delete machine.table[selectedNode['label']];
      //make sure the start state changes if necessary
      if (machine['start state'] === selectedNode['label']) {
        machine['start state'] = nodeLabel.value;
      }
      // change every transition destination node that has the old node's name
      for(var node in machine.table) {
        for (var read in machine.table[node]) {
          for (var i in machine.table[node][read]) {
            if(i === "L" | i === "R") {
              if (machine.table[node][read][i] === selectedNode['label'])
                machine.table[node][read][i] = nodeLabel.value;
            }
          }
        }
      }
      //we're finished here
      source.setValue(jsyaml.safeDump(machine));
      util.setCookie('TMReload', 'node name change');
    }
  }
});

startState.addEventListener('change', function(){
  //this one is pretty foolproof
  var machine = jsyaml.safeLoad(source.getValue());
  machine['start state'] = nodeLabel.value;
  startState.disabled = true;
  source.setValue(jsyaml.safeDump(machine));
  util.setCookie('TMReload', 'start state');
})

deleteNode.addEventListener('click', function (){
  //this one needs the full transition loop sorting before it works fully but basic node deletion is pretty easy
  //get machine code
  if(!startState.checked) {
    var machine = jsyaml.safeLoad(source.getValue());
    //delete every transition with the same name as the node being deleted
    delete machine.table[nodeLabel.value];
    for (var node in machine.table) {
      for (var read in machine.table[node]) {
        for (var i in machine.table[node][read]) {
          if(i === "L" | i === "R") {
            if (machine.table[node][read][i] === nodeLabel.value)
              delete machine.table[node][read];
          }
        }
      }
    }
    source.setValue(jsyaml.safeDump(machine));
    disableEditing();
    util.setCookie('TMReload', 'deleted a node');
  } else {
    //don't let the user delete the start state
    throwMachineError("Change the start state before trying to delete this node");
  }
})

read.addEventListener('focusout', function () {
  //has the contents of the box changed?
  var transitionContents = selectedLink.labels[0].split("→");
  if(!(transitionContents[0] === read.value)) {
    //get machine
    var machine = jsyaml.safeLoad(source.getValue());
    //check if any read symbol duplicated (the guy didnt implement this to begin with)
    var readSymbolExists = 0;
    for (var readSymbol in machine.table[selectedLink.source['label']]) {
      for (var symbol of read.value.split(",")){
        if (readSymbol.includes(symbol) && !(transitionContents[0].includes(symbol))) {
          readSymbolExists = 1;
          break;
        }
      }
      if (readSymbolExists) break;
    }
    if(!readSymbolExists) {
      //delete entry corresponding to old read symbol(s), re-add entry with new read symbols
      machine['table'][selectedLink.source['label']][read.value] = machine['table'][selectedLink.source['label']][transitionContents[0]];
      delete machine['table'][selectedLink.source['label']][transitionContents[0]];
      //we're finished here
      source.setValue(jsyaml.safeDump(machine));
      util.setCookie('TMReload', 'transition changed');
    } else {
      //throw error if any read symbol appears elsewhere in the source node's table
      throwMachineError("One or more entered read symbol(s) appear(s) in another transition");
    }
  }
})

write.addEventListener('focusout', function () {
  var boxContents = selectedLink.labels[0].split("→");
  if(boxContents[1].includes(",")) {
    var splitTransition = boxContents[1].split(",");
    if(!(splitTransition[0] === write.value)){
      //get machine
      var machine = jsyaml.safeLoad(source.getValue());
      //replace the written symbol or delete it if write left empty
      if(write.value) {
        machine['table'][selectedLink.source['label']][boxContents[0]]['write'] = write.value;
      } else {
        delete machine['table'][selectedLink.source['label']][boxContents[0]]['write'];
      }
      //we're finished here
      source.setValue(jsyaml.safeDump(machine));
      util.setCookie('TMReload', 'transition write changed');
    }
  } else {
    if(write.value) {
      //there is now a value for write
      //grab the machine
      var machine = jsyaml.safeLoad(source.getValue());
      //add a write parameter to the object
      machine['table'][selectedLink.source['label']][boxContents[0]]['write'] = write.value;
      //we're finished here
      source.setValue(jsyaml.safeDump(machine));
      util.setCookie('TMReload', 'transition write changed');
    }
  }
})

moveL.addEventListener('click', function () {
  //probably pretty simple
  //disable L, enable R, push L transition, delete R transition
  moveL.disabled = true;
  moveR.disabled = false;
  moveL.classList.toggle('btn-secondary');
  moveL.classList.toggle('btn-success');
  moveR.classList.toggle('btn-success');
  moveR.classList.toggle('btn-secondary');

  //grab the machine
  var machine = jsyaml.safeLoad(source.getValue());
  //find the transition based on source node and read box
  machine['table'][selectedLink.source['label']][read.value]['L'] = machine['table'][selectedLink.source['label']][read.value]['R'];
  delete machine['table'][selectedLink.source['label']][read.value]['R'];
  //we're finished here
  source.setValue(jsyaml.safeDump(machine));
  util.setCookie('TMReload', 'head movement changed');
})

moveR.addEventListener('click', function () {
  //probably pretty simple
  //disable R, enable L, push R transition, delete L transition
  moveR.disabled = true;
  moveL.disabled = false;
  moveR.classList.toggle('btn-secondary');
  moveR.classList.toggle('btn-success');
  moveL.classList.toggle('btn-success');
  moveL.classList.toggle('btn-secondary');

  //grab the machine
  var machine = jsyaml.safeLoad(source.getValue());
  //find the transition based on source node and read box
  machine['table'][selectedLink.source['label']][read.value]['R'] = machine['table'][selectedLink.source['label']][read.value]['L'];
  delete machine['table'][selectedLink.source['label']][read.value]['L'];
  //we're finished here
  source.setValue(jsyaml.safeDump(machine));
  util.setCookie('TMReload', 'head movement changed');
})

deleteLink.addEventListener('click', function (){
  //this should be easier than deleting a node
  //find read symbols inside source node object, delete read symbols (without replacing)
  //grab the machine
  var machine = jsyaml.safeLoad(source.getValue());
  delete machine['table'][selectedLink.source['label']][read.value];
  //we're finished here
  source.setValue(jsyaml.safeDump(machine));
  disableEditing();
  util.setCookie('TMReload', 'delete link');
})

// Positioning

// {[key: State]: Node} -> PositionTable
var getPositionTable = _.mapValues(_.pick(['x', 'y', 'px', 'py', 'fixed']));

// Tag nodes w/ positions. Mutates the node map.
// PositionTable -> {[key: State]: Node} -> void
function setPositionTable(posTable, stateMap) {
  _.forEach(function (node, state) {
    var position = posTable[state];
    if (position !== undefined) {
      assign(node, position);
    }
  }, stateMap);
}

//TODO (stretchier goal) have the nodes remain in place when being renamed
Object.defineProperty(StateViz.prototype, 'positionTable', {
  get: function () { return getPositionTable(this.__stateMap); },
  set: function (posTable) {
    setPositionTable(posTable, this.__stateMap);
    // ensure that a cooled layout will update
    this.force.resume();
  }
});


module.exports = StateViz;
