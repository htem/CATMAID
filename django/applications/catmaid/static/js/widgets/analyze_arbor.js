/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */

"use strict";

var AnalyzeArbor = function() {
  this.widgetID = this.registerInstance();
  this.registerSource();

  this.table = null;
  this.skeleton_ids = [];
};

AnalyzeArbor.prototype = {};
$.extend(AnalyzeArbor.prototype, new InstanceRegistry());
$.extend(AnalyzeArbor.prototype, new SkeletonSource());

AnalyzeArbor.prototype.getName = function() {
  return "Analyze Arbor " + this.widgetID;
};

AnalyzeArbor.prototype.destroy = function() {
  delete this.linkTarget;
  this.clear(); // clear after clearing linkTarget, so it doesn't get cleared
  this.unregisterInstance();
  this.unregisterSource();
  NeuronNameService.getInstance().unregister(this);
};

AnalyzeArbor.prototype.update = function() {
  var skids = this.skeleton_ids,
      models = this.getSelectedSkeletonModels();
  this.clear();
  this.appendOrdered(skids, models);
};

AnalyzeArbor.prototype.clear = function() {
  this.table.fnClearTable();
  this.skeleton_ids = [];
};

AnalyzeArbor.prototype.removeSkeletons = function() {};
AnalyzeArbor.prototype.updateModels = function() {};
AnalyzeArbor.prototype.highlight = function(skeleton_id) {
  // TODO highlight row
};

AnalyzeArbor.prototype.getSelectedSkeletons = function() {
  return this.skeleton_ids.slice(0);
};

AnalyzeArbor.prototype.getSkeletonColor = function() {
  return ActiveSkeleton.prototype.getSkeletonColor();
};

AnalyzeArbor.prototype.hasSkeleton = function(skeleton_id) {
  return -1 !== this.skeleton_ids.indexOf(skeleton_id);
};

AnalyzeArbor.prototype.createModel = function(skeleton_id) {
  var name = NeuronNameService.getInstance().getName(skeleton_id);
  return new SelectionTable.prototype.SkeletonModel(skeleton_id, name, this.getSkeletonColor());
};

AnalyzeArbor.prototype.getSelectedSkeletonModels = function() {
  return this.skeleton_ids.reduce((function(o, skid) {
    o[skid] = this.createModel(skid);
    return o;
  }).bind(this), {});
};

AnalyzeArbor.prototype.getSkeletonModels = AnalyzeArbor.prototype.getSelectedSkeletonModels;

AnalyzeArbor.prototype.updateNeuronNames = function() {
  this.skeleton_ids.forEach(function(skid, i) {
    this.table.fnUpdate(NeuronNameService.getInstance().getName(skid), i, 0);
  }, this);
};


AnalyzeArbor.prototype.init = function() {
  this.table = $('#analyzearbor' + this.widgetID).dataTable({
      // http://www.datatables.net/usage/options
      "bDestroy": true,
      "sDom": '<"H"lr>t<"F"ip>',
      // default: <"H"lfr>t<"F"ip>
      "bProcessing": true,
      "bServerSide": false, // Enable sorting locally, and prevent sorting from calling the fnServerData to reload the table -- an expensive and undesirable operation.
      "bAutoWidth": false,
      "iDisplayLength": -1,
      "aLengthMenu": [
        [-1, 10, 100, 200],
        ["All", 10, 100, 200]
      ],
      //"aLengthChange": false,
      "bJQueryUI": true,
      "aoColumns": [{bSearchable: true, bSortable: true}].concat((function() {
        var a = [];
        for (var i=0; i<16; ++i) a.push({bSearchable: true, bSortable: true});
        return a;
      })()),
  });

  this.table.fnClearTable();
};

AnalyzeArbor.prototype.append = function(models) {
  this.appendOrdered(Object.keys(models), models);
};

AnalyzeArbor.prototype.appendOrdered = function(skids, models) {
  NeuronNameService.getInstance().registerAll(this, models, (function() {
    fetchSkeletons(
        skids,
        function(skid) { return django_url + project.id + '/' + skid + '/1/1/1/compact-arbor-with-minutes'; },
        function(skid) { return {}; },
        this.appendOne.bind(this),
        function(skid) { growlAlert("ERROR", "Failed to load skeleton #" + skid); },
        function() {});
  }).bind(this));
};

/** json: from URL compact-arbor (nodes, synapses and tags). */
AnalyzeArbor.prototype.appendOne = function(skid, json) {
  var tags = json[2],
      microtubules_end = tags['microtubules end'];

  if (!microtubules_end || 0 === microtubules_end.length) {
    return alert("Skeleton #" + skid + " does not have any node tagged 'microtubules end'.");
  }

  var ap = new ArborParser(json).init('compact-arbor', json);
  // Collapse "not a branch"
  ap.collapseArtifactualBranches(tags);

  var minutes = json[3],
      inv_minutes = {};
  Object.keys(minutes).forEach(function(min) {
    minutes[min].forEach(function(nodeID) {
      inv_minutes[nodeID] = min;
    });
  });
  var countMinutes = function(nodes) {
    var mins = {};
    nodes.forEach(function(nodeID) { mins[inv_minutes[nodeID]] = true; });
    return Object.keys(mins).length;
  };
  var subtract = function(o1, o2) {
    var o = {};
    Object.keys(o1).forEach(function(key) {
      if (o2[key]) return;
      o[key] = o1[key];
    });
    return o;
  };

  var smooth_positions = ap.arbor.smoothPositions(ap.positions, 200, null),
      cable = ap.arbor.cableLength(smooth_positions),
      microtubules_end_nodes = microtubules_end.reduce(function(o, nodeID) { o[nodeID] = true; return o; }, {}),
      outputs = Object.keys(ap.outputs),
      inputs = Object.keys(ap.inputs),
      count = function(sum, nodeID) { return sum + this[nodeID]; },
      countOutputs = count.bind(ap.outputs),
      countInputs = count.bind(ap.inputs);

  // Detect and measure the backbone
  var backbone = ap.arbor.upstreamArbor(microtubules_end_nodes),
      bb_cable = backbone.cableLength(smooth_positions),
      bb_f = function(nodeID) { return backbone.contains(nodeID); },
      bb_n_outputs = outputs.filter(bb_f).reduce(countOutputs, 0),
      bb_n_inputs = inputs.filter(bb_f).reduce(countInputs, 0),
      bb_minutes = countMinutes(backbone.nodesArray());

  var ad;

  // Split by synapse flow centrality
  if (0 !== ap.n_outputs && 0 !== ap.n_inputs) {
    var fc = ap.arbor.flowCentrality(ap.outputs, ap.inputs, ap.n_outputs, ap.n_inputs),
        fc_max = Object.keys(fc).reduce(function(max, nodeID) {
          var c = fc[nodeID].centrifugal;
          return c > max ? c : max;
        }, 0),
        fc_plateau = Object.keys(fc).filter(function(nodeID) { return fc[nodeID].centrifugal === fc_max; }),
        cut = SynapseClustering.prototype.findAxonCut(ap.arbor, ap.outputs, fc_plateau);

    // Detect and measure the axon
    var axon_terminals = ap.arbor.subArbor(cut),
        at_backbone = axon_terminals.upstreamArbor(microtubules_end_nodes),
        at_backbone_cable = at_backbone.cableLength(smooth_positions),
        at_cable = axon_terminals.cableLength(smooth_positions) - at_backbone_cable,
        at_f = function(nodeID) { return axon_terminals.contains(nodeID) && !at_backbone.contains(nodeID); },
        at_n_outputs = outputs.filter(at_f).reduce(countOutputs, 0),
        at_n_inputs = inputs.filter(at_f).reduce(countInputs, 0),
        at_minutes = countMinutes(Object.keys(subtract(axon_terminals.nodes(), at_backbone.nodes())));

    // Detect and measure the dendrites
    var dendrites = ap.arbor.clone();
    axon_terminals.nodesArray().forEach(function(nodeID) {
      delete dendrites.edges[nodeID];
    });
    var d_backbone = dendrites.upstreamArbor(microtubules_end_nodes),
        d_backbone_cable = d_backbone.cableLength(smooth_positions),
        d_cable = dendrites.cableLength(smooth_positions) - d_backbone_cable,
        d_f = function(nodeID) { return dendrites.contains(nodeID) && !d_backbone.contains(nodeID); },
        d_n_outputs = outputs.filter(d_f).reduce(countOutputs, 0),
        d_n_inputs = inputs.filter(d_f).reduce(countInputs, 0),
        d_minutes = countMinutes(Object.keys(subtract(dendrites.nodes(), d_backbone.nodes())));

    ad = [Math.round(d_cable) | 0,
          d_n_inputs,
          d_n_outputs,
          d_minutes,
          Math.round(at_cable) | 0,
          at_n_inputs,
          at_n_outputs,
          at_minutes];
  } else {
    // Consider non-backbone parts as "dendrites"
    ad = [Math.round(cable - bb_cable) | 0,
          ap.n_inputs - bb_n_inputs,
          ap.n_outputs - bb_n_outputs,
          countMinutes(Object.keys(subtract(ap.arbor.nodes(), backbone.nodes()))),
          0,
          0,
          0,
          0];
  }

  var row = [NeuronNameService.getInstance().getName(skid),
             Math.round(cable) | 0,
             ap.n_inputs,
             ap.n_outputs,
             Object.keys(minutes).length,
             Math.round(bb_cable) | 0,
             bb_n_inputs,
             bb_n_outputs,
             bb_minutes].concat(ad);


  this.table.fnAddData(row);
  this.skeleton_ids.push(Number(skid));
};