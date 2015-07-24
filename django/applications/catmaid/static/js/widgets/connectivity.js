/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */
/* vim: set softtabstop=2 shiftwidth=2 tabstop=2 expandtab: */
/* global
  InstanceRegistry,
  NeuronNameService,
  project,
  requestQueue,
  SelectionTable,
  User,
  WindowMaker
*/

(function(CATMAID) {

  "use strict";

  var SkeletonConnectivity = function() {
    this.widgetID = this.registerInstance();
    this.registerSource();
    this.init();
    // Default table layout to be side by side. Have it seperate from init() as
    // long as it is part of the top button row.
    this.tablesSideBySide = true;
    // Do not update automatically by default
    this.autoUpdate = false;

    // Register for changed and removed skeletons
    CATMAID.neuronController.on(CATMAID.neuronController.EVENT_SKELETON_CHANGED,
      this.handleChangedSkeleton, this);
    CATMAID.neuronController.on(CATMAID.neuronController.EVENT_SKELETON_DELETED,
      this.handleDeletedSkeleton, this);
  };

  SkeletonConnectivity.prototype = {};
  $.extend(SkeletonConnectivity.prototype, new InstanceRegistry());
  $.extend(SkeletonConnectivity.prototype, new CATMAID.SkeletonSource());

  /**
   * Initializes the connectivity widget by setting all fields to their default
   * value.
   */
  SkeletonConnectivity.prototype.init = function() {
    // An ordered list of neurons/skeletons for display
    this.ordered_skeleton_ids = [];
    // An (per se unordered) object mapping skeletonIDs to skeleton names
    this.skeletons = {};
    // Incoming an outgoing connections of current neurons
    this.incoming = {};
    this.outgoing = {};
    this.reviewers = new Set();
    // Default upstream and downstream tables to be not collapsed
    this.upstreamCollapsed = false;
    this.downstreamCollapsed = false;
    // Thresholds for current skeleton set
    this.upThresholds = {};
    this.downThresholds = {};
    // Update all threshold selection states
    this.upAllThresholds = 1;
    this.downllThresholds = 1;
    // Filter partners with fewer nodes than this threshold
    this.hidePartnerThreshold = 1;
    // ID of the user who is currently reviewing or null for 'union'
    this.reviewFilter = null;
    // An object mapping skeleton IDs to their selection state
    this.skeletonSelection = {};
    // An object for remembering the selection state of the select-all controls
    this.selectAllSelection = {
      'up': false,
      'down': false,
    };
  };

  /** Appends only to the top list, that is, the set of seed skeletons
   *  for which all pre- and postsynaptic partners are listed. */
  SkeletonConnectivity.prototype.append = function(models) {
    var skeletons = this.skeletons,
        added = 0,
        removed = 0,
        widgetID = this.widgetID;
    var new_skeletons = Object.keys(models).reduce(function(o, skid) {
      var model = models[skid];
      if (skid in skeletons) {
        if (model.selected) {
          // Update name
          skeletons[skid] = model.baseName;
          $('#a-connectivity-table-' + widgetID + '-' + skid).html(
              NeuronNameService.getInstance().getName(skid));
        } else {
          // Remove
          delete skeletons[skid];
          ++removed;
        }
      } else {
        if (model.selected) {
          o[skid] = models[skid].baseName;
          ++added;
        }
      }
      return o;
    }, {});

    if (0 === removed && 0 === added) {
      return;
    }
    
    // Update existing ones and add new ones
    $.extend(this.skeletons, new_skeletons);
    for (var skid in new_skeletons) {
      this.ordered_skeleton_ids.push(parseInt(skid));
    }

    // Add skeletons
    NeuronNameService.getInstance().registerAll(this, models, (function() {
      this.update();
      this.updateLink(models);
    }).bind(this));
  };

  SkeletonConnectivity.prototype.getName = function() {
    return "Connectivity " + this.widgetID;
  };

  SkeletonConnectivity.prototype.destroy = function() {
    this.unregisterInstance();
    this.unregisterSource();
    NeuronNameService.getInstance().unregister(this);

    // Unregister from neuron controller
    CATMAID.neuronController.off(CATMAID.neuronController.EVENT_SKELETON_CHANGED,
        this.handleChangedSkeleton, this);
    CATMAID.neuronController.off(CATMAID.neuronController.EVENT_SKELETON_DELETED,
        this.handleDeletedSkeleton, this);
  };

  SkeletonConnectivity.prototype.clear = function(source_chain) {
    this.init();
    this.update();
    this.clearLink(source_chain);
  };

  SkeletonConnectivity.prototype.removeSkeletons = function(skeleton_ids) {
    var deletedSkeletons = skeleton_ids.filter(function(skid) {
      delete this.skeletons[skid];
      var index = this.ordered_skeleton_ids.indexOf(skid);
      if (index > -1) {
        this.ordered_skeleton_ids.splice(index, 1);
        return true;
      }
      return false;
    }, this);

    // Only update if skeletons where actually removed
    if (deletedSkeletons.length > 0) {
      this.update();
      this.updateLink(this.getSelectedSkeletonModels());
    }
  };

  SkeletonConnectivity.prototype.hasSkeleton = function(skeleton_id) {
    return skeleton_id in this.skeletons;
  };

  SkeletonConnectivity.prototype.updateModels = function(models, source_chain) {
    if (source_chain && (this in source_chain)) return; // break propagation loop
    if (!source_chain) source_chain = {};
    source_chain[this] = this;

    this.append(models);
  };

  SkeletonConnectivity.prototype.highlight = function(skeleton_id) {
    // TODO color the table row in green if present, clear all others
  };

  SkeletonConnectivity.prototype.getSelectedSkeletons = function() {
    // TODO refactor to avoid unnecessary operations
    return Object.keys(this.getSelectedSkeletonModels());
  };

  SkeletonConnectivity.prototype.getSkeletonModel = function(skeleton_id) {
    var e_name = $('#a-connectivity-table-' + this.widgetID + '-' + skeleton_id);
    if (0 === e_name.length) return null;
    var name = e_name.text();

    var pre = $("#presynaptic_to-show-skeleton-" + this.widgetID + "-" + skeleton_id);
    var post = $("#postsynaptic_to-show-skeleton-" + this.widgetID + "-" + skeleton_id);

    var color = new THREE.Color();
    if (pre.length > 0) {
      if (post.length > 0) color.setRGB(0.8, 0.6, 1); // both
      else color.setRGB(1, 0.4, 0.4); // pre
    } else if (post.length > 0) color.setRGB(0.5, 1, 1); // post

    var model = new SelectionTable.prototype.SkeletonModel(skeleton_id, name, color);
    model.selected = pre.prop('checked') || post.prop('checked');
    return model;
  };

  SkeletonConnectivity.prototype.getSelectedSkeletonModels = function() {
    var widgetID = this.widgetID;
    var skeletons = this.skeletons;
    // Read out skeletons from neuron list
    var models = Object.keys(this.skeletons).reduce(function(o, skid) {
      // Test if checked
      var cb = $('input#neuron-selector-' + widgetID + '-' + skid +
          '[type=checkbox]');
      if (cb.prop('checked')) {
        var name = skeletons[skid];
        o[skid] = new SelectionTable.prototype.SkeletonModel(skid,
            skeletons[skid], new THREE.Color().setRGB(1, 1, 0));
      }
      return o;
    }, {});

    var colors = [new THREE.Color().setRGB(1, 0.4, 0.4),
                  new THREE.Color().setRGB(0.5, 1, 1),
                  new THREE.Color().setRGB(0.8, 0.6, 1)];
    // Read out all skeletons
    var sks = {};
    ['presynaptic_to', 'postsynaptic_to'].forEach(function(relation, index) {
      $("input[id^='" + relation + "-show-skeleton-" + widgetID + "-']").each(function(i, e) {
        var skid = parseInt(e.value);
        if (!(skid in sks)) sks[skid] = {};
        sks[skid][index] = e.checked;
      });
    });
    // Pick those for which at least one checkbox is checked (if they have more than one)
    Object.keys(sks).forEach(function(skid) {
      var sk = sks[skid];
      if (true === sk[0] || true === sk[1]) {
        var index = -1;
        if (0 in sk) {
          if (1 in sk) index = 2; // exists in both pre and post
          else index = 0;
        } else if (1 in sk) index = 1;
        var name = $('#a-connectivity-table-' + widgetID + '-' + skid).text();
        models[skid] = new SelectionTable.prototype.SkeletonModel(skid, name, colors[index].clone());
      }
    });

    return models;
  };

  /**
   * Return true if the given skeleton is a partner.
   */
  SkeletonConnectivity.prototype.isPartner = function(skeletonID) {
    return this.incoming.hasOwnProperty(skeletonID) ||
      this.outgoing.hasOwnProperty(skeletonID);
  };

  /**
   * Refresh the widget if the changed skeleton was displayed as an
   * input skeleton or as a partner.
   */
  SkeletonConnectivity.prototype.handleChangedSkeleton = function(skeletonID) {
    if (this.autoUpdate) {
      if (this.hasSkeleton(skeletonID) || this.isPartner(skeletonID)) {
        this.update();
      }
    }
  };

  /**
   * Refresh the widget if the changed skeleton was displayed as a partner.
   * Removal of input skeletons is dealt with separately.
   */
  SkeletonConnectivity.prototype.handleDeletedSkeleton = function(skeletonID) {
    if (this.autoUpdate) {
      if (this.isPartner(skeletonID)) {
        this.update();
      }
    }
  };

  /**
   * Clears the widgets content container.
   */
  SkeletonConnectivity.prototype._clearGUI = function() {
    // Clear widget
    $("#connectivity_widget" + this.widgetID).empty();
  };

  SkeletonConnectivity.prototype.update = function() {
    var skids = Object.keys(this.skeletons);
    if (0 === skids.length) {
      this._clearGUI();
      return;
    }

    var self = this;

    requestQueue.replace(
        django_url + project.id + '/skeleton/connectivity',
        'POST',
        {'source': skids,
         'boolean_op': $('#connectivity_operation' + this.widgetID).val()},
        function(status, text) {
          var handle = function(status, text) {
            if (200 !== status) {
              self.incoming = {};
              self.outgoing = {};
              self.reviewers.clear();
              new CATMAID.ErrorDialog("Couldn't load connectivity information",
                  "The server returned an unexpected status code: " +
                      status).show();
              return;
            }
            var json = $.parseJSON(text);
            if (json.error) {
              if ('REPLACED' !== json.error) {
                self.incoming = {};
                self.outgoing = {};
                self.reviewers.clear();
                new CATMAID.ErrorDialog("Couldn't load connectivity information",
                    json.error).show();
              }
              return;
            }

            // Save reference of incoming and outgoing nodes. These are needed to open
            // the connectivity plots in a separate widget.
            self.incoming = json.incoming;
            self.outgoing = json.outgoing;
            self.reviewers.clear();
            json.incoming_reviewers.forEach(self.reviewers.add.bind(self.reviewers));
            json.outgoing_reviewers.forEach(self.reviewers.add.bind(self.reviewers));

            // Register this widget with the name service for all neurons
            var createPartnerModels = function(partners, result) {
              for (var skid in partners) {
                result[skid] = new SelectionTable.prototype.SkeletonModel(skid, '', null);
              }
            };
            var partnerModels = {};
            createPartnerModels(self.incoming, partnerModels);
            createPartnerModels(self.outgoing, partnerModels);

            // Make all partners known to the name service
            NeuronNameService.getInstance().registerAll(self, partnerModels, self.redraw.bind(self));
          };

          // Handle result and create tables, if possible
          handle(status, text);
        },
        'update_connectivity_table');
  };

  /**
   * Change the selection state of a single skeleton and update the appropriate
   * checkboxes (instead of triggering a redraw()).
   */
  SkeletonConnectivity.prototype.selectSkeleton = function(skid, selected) {
      this.skeletonSelection[skid] = selected;
      this.updateVisibility(skid, selected);
      $('#neuron-selector-' + this.widgetID + '-' + skid).prop('checked', selected);
      $('#presynaptic_to-show-skeleton-' + this.widgetID + '-' + skid).prop('checked', selected);
      $('#postsynaptic_to-show-skeleton-' + this.widgetID + '-' + skid).prop('checked', selected);

      // Check the select all box, if all skeletons are selected
      var notSelected = function(skid) { return !this.skeletonSelection[skid]; };
      var allLookedAtSelected = !this.ordered_skeleton_ids.some(notSelected, this);
      $('#neuron-select-all-' + this.widgetID).prop('checked', allLookedAtSelected);
  };

  /**
   *  Support function to update the visibility of a neuron in another widget.
   */
  SkeletonConnectivity.prototype.updateVisibility = function(skid, visible) {
      // Tell all linked widgets about this change or return if there are none
      var linkTarget = this.getLinkTarget();
      if (!linkTarget) return;

      var model = linkTarget.getSkeletonModel(skid);
      if (visible) {
        if (!model) model = this.getSkeletonModel(skid);
        else model.setVisible(true);
        linkTarget.updateOneModel(model);
      } else {
        if (model) {
          model.setVisible(false);
          linkTarget.updateOneModel(model);
        }
      }
  };

  SkeletonConnectivity.prototype.redraw = function() {

    // Record the state of checkboxes
    var checkboxes = [{}, {}],
        widgetID = this.widgetID,
        relations = ['presynaptic_to', 'postsynaptic_to'];
    relations.forEach(function(relation, index) {
      $("[id^='" + relation + "-show-skeleton-" + widgetID + "-']").each(function(_, checkbox) {
        checkboxes[index][checkbox.value] = checkbox.checked;
      });
    });

    // Create connectivity tables
    this.createConnectivityTable();

    // Restore checkbox state
    checkboxes.forEach((function(c, i) {
      var relation = relations[i];
      Object.keys(c).forEach((function(skeleton_id) {
        var sel = $('#' + relation + '-show-skeleton-' + this.widgetID + '-' + skeleton_id);
        if (sel.length > 0) {
          sel.prop('checked', c[skeleton_id]);
        }
      }).bind(this));
    }).bind(this));
  };

  /**
   * This method is called from the neuron name service, if neuron names are
   * changed.
   */
  SkeletonConnectivity.prototype.updateNeuronNames = function() {
    $("#connectivity_widget" + this.widgetID)
        .find('[data-skeleton-id]')
        .each(function (index, element) {
          this.textContent = NeuronNameService.getInstance().getName(this.getAttribute('data-skeleton-id'));
    });

    $("#connectivity_widget" + this.widgetID)
        .find('.syncount[skid]')
        .each(function (index, element) {
          var count = this.firstChild.textContent;
          this.setAttribute('title', count + " synapse(s) for neuron '" +
              NeuronNameService.getInstance().getName(this.getAttribute('skid')));
    });

    var widgetID = this.widgetID;
    ['presynaptic', 'postsynaptic'].forEach(function (partnerSet) {
      var table = $("#" + partnerSet + '_tostream_connectivity_table' + widgetID);

      // Inform DataTables that the data has changed.
      table.DataTable().rows().invalidate().draw();
    });
  };

  SkeletonConnectivity.prototype.updateReviewSummaries = function () {
    var partnerSkids = [this.incoming, this.outgoing].reduce(function (skids, partners) {
      return skids.concat(Object.keys(partners));
    }, []);

    var self = this;
    var request = {skeleton_ids: partnerSkids, whitelist: this.reviewFilter === 'whitelist'};
    if (this.reviewFilter && this.reviewFilter !== 'whitelist') request.user_ids = [this.reviewFilter];
    return new Promise(function (resolve, reject) {
      requestQueue.register(
          CATMAID.makeURL(project.id + '/skeleton/review-status'),
          'POST',
          request,
          CATMAID.jsonResponseHandler(function(json) {
              $("#connectivity_widget" + self.widgetID)
                  .find('.review-summary[skid]')
                  .each(function (index, element) {
                    var counts = json[this.getAttribute('skid')];
                    var pReviewed = parseInt(Math.floor(100 * counts[1] / counts[0])) | 0;
                    this.textContent = pReviewed + '%';
                    this.style.backgroundColor = CATMAID.ReviewSystem.getBackgroundColor(pReviewed);
              });

              $("#connectivity_widget" + self.widgetID)
                  .find('.node-count[skid]')
                  .each(function (index, element) {
                    var counts = json[this.getAttribute('skid')];
                    this.textContent = counts[0];
              });

              ['incoming', 'outgoing'].forEach(function (partnerSet) {
                var countSums = Object.keys(self[partnerSet]).reduce(function (nodes, partner) {
                  var count = json[partner];
                  return [nodes[0] + count[0], nodes[1] + count[1]];
                }, [0, 0]);

                var pReviewed = parseInt(Math.floor(100 * countSums[1] / countSums[0])) | 0;
                var table = $("#" +
                    (partnerSet === 'incoming' ? 'presynaptic' : 'postsynaptic') +
                    '_tostream_connectivity_table' + self.widgetID);
                table.find('.node-count-total').text(countSums[0]);
                table.find('.review-summary-total').each(function () {
                  this.textContent = pReviewed + '%';
                  this.style.backgroundColor = CATMAID.ReviewSystem.getBackgroundColor(pReviewed);
                });

                // Inform DataTables that the data has changed.
                table.DataTable().rows().invalidate().draw();
              });
              resolve();
            }, reject));
    });
  };

  SkeletonConnectivity.prototype.createConnectivityTable = function() {
    // Simplify access to this widget's ID in sub functions
    var widgetID = this.widgetID;
    // Simplify access to pre-bound skeleton source and instance registry methods
    var getLinkTarget = this.getLinkTarget.bind(this);
    var getSkeletonModel = this.getSkeletonModel.bind(this);

    /**
     * Support function for creating a neuron/skeleton name link element in the
     * neuron list and both pre- and postsynaptic tables.
     */
    var createNameElement = function(name, skeleton_id) {
      var a = document.createElement('a');
      a.appendChild(document.createTextNode(NeuronNameService.getInstance().getName(skeleton_id)));
      a.setAttribute('href', '#');
      a.setAttribute('id', 'a-connectivity-table-' + widgetID + '-' + skeleton_id);
      a.setAttribute('data-skeleton-id', skeleton_id);
      return a;
    };

    /**
     * Support function to updates the layout of the tables.
     */
    var layoutTables = function(sideBySide) {
      incoming.toggleClass('table_container_half', sideBySide);
      incoming.toggleClass('table_container_wide', !sideBySide);
      outgoing.toggleClass('table_container_half', sideBySide);
      outgoing.toggleClass('table_container_wide', !sideBySide);
    };

    /**
     * Helper to get the synpatic count of a skeleton ID dictionary.
     */
    var synaptic_count = function(skids_dict) {
      return Object.keys(skids_dict).reduce(function(sum, skid) {
        return sum + skids_dict[skid];
      }, 0);
    };

    /**
     * Helper to sort an array.
     */
    var to_sorted_array = function(partners) {
      return Object.keys(partners).reduce(function(list, skid) {
        var partner = partners[skid];
        partner['id'] = parseInt(skid);
        partner['synaptic_count'] = synaptic_count(partner.skids);
        list.push(partner);
        return list;
      }, []).sort(function(a, b) {
        return b.synaptic_count - a.synaptic_count;
      });
    };

    /**
     * Support function for creating a partner table.
     */
    var create_table = function(skids, skeletons, thresholds, partners, title, relation,
        hidePartnerThreshold, reviewFilter, collapsed, collapsedCallback) {
      // Create table with unique ID and the class 'partner_table'
      var table = $('<table />').attr('id', relation + 'stream_connectivity_table' + widgetID)
              .attr('class', 'partner_table');

      /* The table header will be slightly different if there is more than one
       * neuron currently looked at. In this case, the 'syn count' column will
       * have sub columns for the sum and the respective individual columns. */
      var extraCols = skids.length > 1;
      var headerRows = extraCols ? 2 : 1;

      /**
       * Support function to sum up fields of elemends of an array.
       */
      var getSum = function(elements, field) {
        return elements.reduce(function(sum, e) {
          return sum + e[field];
        }, 0);
      };
      // The total synapse count
      var total_synaptic_count = getSum(partners, 'synaptic_count');

      // The table header
      var thead = $('<thead />');
      table.append( thead );
      var row = $('<tr />');
      row.append( $('<th />').text("select").attr('rowspan', headerRows));
      row.append( $('<th />').text(title + "stream neuron").attr('rowspan',
          headerRows));
      row.append( $('<th />').text("syn count").attr('rowspan', 1).attr('colspan',
          extraCols ? skids.length + 1 : 1));
      row.append( $('<th />').text("reviewed").attr('rowspan', headerRows));
      row.append( $('<th />').text("node count").attr('rowspan', headerRows));
      thead.append( row );
      if (extraCols) {
        row = $('<tr />');
        row.append( $('<th />').text("Sum").attr('rowspan', '1').attr('colspan', '1'));
        skids.forEach(function(s, i) {
          this.append( $('<th />').text(i+1 + ".").attr('rowspan', '1').attr('colspan', '1'));
        }, row);
        thead.append(row);
      }

      // The aggregate row
      row = $('<tr />');
      var el = $('<input type="checkbox" id="' + title.toLowerCase() + 'stream-selectall' +  widgetID + '" />');
      if (this.selectAllSelection[title.toLowerCase()]) {
        el.prop('checked', true);
      }
      row.append( $('<td />').addClass('input-container').append( el ) );
      var titleClass = collapsed ? "extend-box-closed" : "extend-box-open";
      var titleCell = $('<td />').html('<span class="' + titleClass +
              '"></span>ALL (' + partners.length + ' neurons)');
      row.append(titleCell);
      row.append($('<td />').addClass('syncount').text(total_synaptic_count));
      if (extraCols) {
        skids.forEach(function(skid) {
          var count = partners.reduce(function(sum, partner) {
            return sum + (partner.skids[skid] || 0);
          }, 0);
          this.append($('<td />').addClass('syncount').text(count));
        }, row);
      }

      row.append($('<td />').addClass('review-summary-total'));
      row.append($('<td />').addClass('node-count-total'));
      thead.append(row);

      var tbody = $('<tbody />');
      table.append( tbody );
      if (collapsed) {
        tbody.css('display', "none");
      }

      // Add handler to first row
      $('span', titleCell).click((function(element) {
        return function(e) {
          e.stopPropagation();
          var $title = $(this);
          // Toggle visibility of the complete table body
          element.toggle(200, function() {
            // Change open/close indidicator box
            $title.toggleClass('extend-box-open extend-box-closed');
          });
          // Call back, if wanted
          if (collapsedCallback) {
            collapsedCallback();
          }
        };
      })(tbody));

      /**
       * Support function to add a table cell that links to a connector selection,
       * displaying a connector count.
       */
      function createSynapseCountCell(count, partner, skid) {
        var td = document.createElement('td');
        var title = skid ?
            count + " synapse(s) for neuron '" +
                NeuronNameService.getInstance().getName(skid) + "'." :
            count + " synapses for all selected neurons.";
        td.setAttribute('class', 'syncount');
        // Only add the count as displayed text if it is greater zero. This
        // reduces visual noise for larger tables.
        if (count > 0) {
          // Create a links that will open a connector selection when clicked. The
          // handler to do this is created separate to only require one handler.
          var a = document.createElement('a');
          td.appendChild(a);
          a.textContent = count;
          a.setAttribute('href', '#');
          a.setAttribute('partnerID', partner.id);
        } else { // Make a hidden span including the zero for semantic clarity and table exports.
          var s = document.createElement('span');
          td.appendChild(s);
          s.textContent = count;
          s.style.display = 'none';
        }
        // Create tool-tip
        td.setAttribute('title', title);
        if (skid) td.setAttribute('skid', skid);
        return td;
      }

      // Create a table row for every partner and remember the ignored ones
      var filtered = partners.reduce((function(filtered, partner) {
        // Ignore this line if all its synapse counts are below the threshold. If
        // the threshold is 'undefined', false is returned and to semantics of
        // this test.
        var ignore = Object.keys(partner.skids).every(function(skid) {
          // Return true if object is below threshold
          return (partner.skids[skid] || 0) < thresholds[skid];
        });
        ignore = ignore || partner.synaptic_count < thresholds['sum'];
        // Ignore partner if it has only fewer nodes than a threshold
        ignore = ignore || partner.num_nodes < hidePartnerThreshold;
        if (ignore) {
          filtered.push(partner);
          return filtered;
        }

        var tr = document.createElement('tr');
        tbody.append(tr);

        // Cell with checkbox for adding to Selection Table
        var td = document.createElement('td');
        td.setAttribute('class', 'input-container');
        var input = document.createElement('input');
        input.setAttribute('id', relation + '-show-skeleton-' + widgetID + '-' + partner.id);
        input.setAttribute('type', 'checkbox');
        input.setAttribute('value', partner.id);
        input.setAttribute('data-skeleton-id', partner.id);
        if (partner.id in this.skeletonSelection) {
          if (this.skeletonSelection[partner.id]) {
            input.setAttribute('checked', 'checked');
          }
        } else {
          this.skeletonSelection[partner.id] = false;
        }
        td.appendChild(input);
        tr.appendChild(td);

        // Cell with partner neuron name
        var td = document.createElement('td');
        var a = createNameElement(partner.name, partner.id);
        td.appendChild(a);
        tr.appendChild(td);

        // Cell with synapses with partner neuron
        tr.appendChild(createSynapseCountCell(partner.synaptic_count, partner));
        // Extra columns for individual neurons
        if (extraCols) {
          skids.forEach(function(skid, i) {
            var count = partner.skids[skid] || 0;
            this.appendChild(createSynapseCountCell(count, partner, skid));
          }, tr);
        }

        // Cell with percent reviewed of partner neuron
        var td = document.createElement('td');
        td.className = 'review-summary';
        td.setAttribute('skid', partner.id);
        td.textContent = '...';
        tr.appendChild(td);

        // Cell with number of nodes of partner neuron
        var td = document.createElement('td');
        td.className = 'node-count';
        td.setAttribute('skid', partner.id);
        td.textContent = '...';
        tr.appendChild(td);

        return filtered;
      }).bind(this), []);

      // If some partners have been filtered (e.g. due to thresholding, hidden
      // one-node-neurons), add another table row to provide information about
      // this.
      if (filtered.length > 0) {
        // The filtered synapse count
        var filtered_synaptic_count = getSum(filtered, 'synaptic_count');
        // Build the row
        var $tr = $('<tr />')
            // Select column
            .append($('<td />'))
            .append($('<td />').append(filtered.length + ' hidden partners'))
            // Synapse count sum column
            .append($('<td />').addClass('syncount')
                .append(filtered_synaptic_count));
        // Synapse count single neuron columns
        if (extraCols) {
          skids.forEach(function(skid, i) {
            var count = filtered.reduce(function(sum, partner) {
              return sum + (partner.skids[skid] || 0);
            }, 0);
            $tr.append($('<td />').addClass('syncount').append(count));
          });
        }
        $tr
            // Review column
            .append($('<td />'))
            // Node count column
            .append($('<td />'));

        // Add column to footer of table
        $(table).append($('<tfoot />').append($tr));
      }

      return table;
    };

    /**
     * Support function to add a 'select all' checkbox.
     */
    var add_select_all_fn = function(widget, name, table, nSkeletons) {
      // Assign 'select all' checkbox handler
      $('#' + name + 'stream-selectall' + widgetID).click(function( event ) {
        event.stopPropagation();
        var linkTarget = getLinkTarget();

        // Remember the check state of this control
        widget.selectAllSelection[name] = this.checked;
        var selfChecked = this.checked;

        var skids = $('tbody input[type="checkbox"]', table).map(function () {
          this.checked = selfChecked;
          var skid = parseInt(this.value);
          widget.skeletonSelection[skid] = selfChecked;
          return skid;
        }).get();

        if (this.checked) {
         if (linkTarget) {
           linkTarget.updateModels(skids.reduce(function(o, skid) {
             // See if the target has the model and update only its selection state
             var model = linkTarget.getSkeletonModel(skid);
             if (!model) model = getSkeletonModel(skid);
             else model.setVisible(true);
             o[skid] = model;
             return o;
           }, {}));
         }
       } else {
         if (linkTarget) {
           linkTarget.updateModels(skids.reduce(function(o, skid) {
             var model = linkTarget.getSkeletonModel(skid);
             if (!model) return o;
             model.setVisible(false);
             o[skid] = model;
             return o;
           }, {}));
         }
       }
      });
    };

    /**
     * Support function to create a threshold selector element.
     */
    var createThresholdSelector = function(id, selected, max) {
      var select = document.createElement('select');
      for (var i=1; i < max; ++i) {
        var option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (selected === i) {
          option.selected = true;
        }
        select.appendChild(option);
      }
      return $(select);
    };

    // Clear table
    this._clearGUI();

    // The content container
    var content = $("#connectivity_widget" + widgetID);

    // A select all check box
    var selectAllCb = $('<input />').attr({
      'id': 'neuron-select-all-' + widgetID,
      'type': 'checkbox',
    }).change((function(widget) {
      return function() {
        var selected = this.checked;
        widget.ordered_skeleton_ids.forEach(function(id) {
          widget.selectSkeleton(id, selected);
        });
      };
    })(this));

    // An update all thresholds for both upstream and downstream is added if
    // there is more than one seed neuron.
    var upThresholdHeader = $('<th />').text('Upstream Threshold');
    var downThresholdHeader = $('<th />').text('Downstream Threshold');
    if (this.ordered_skeleton_ids.length > 1) {
      var upAllThresholdsSel = createThresholdSelector(
          'all-neurons-up-threshold-' + id, this.upAllThresholds || 1, 21);
      var downAllThresholdsSel = createThresholdSelector(
          'all-neurons-down-threshold-' + id, this.downAllThresholds || 1, 21);
      upThresholdHeader.append(upAllThresholdsSel);
      downThresholdHeader.append(downAllThresholdsSel);

      upAllThresholdsSel.change(this, function(e) {
        var widget = e.data;
        var threshold = parseInt(this.value, 10);
        for (var i=0; i<widget.ordered_skeleton_ids.length; ++i) {
          widget.upThresholds[widget.ordered_skeleton_ids[i]] = threshold;
        }
        widget.upAllThresholds = threshold;
        widget.redraw();
      });

      downAllThresholdsSel.change(this, function(e) {
        var widget = e.data;
        var threshold = parseInt(this.value, 10);
        for (var i=0; i<widget.ordered_skeleton_ids.length; ++i) {
          widget.downThresholds[widget.ordered_skeleton_ids[i]] = threshold;
        }
        widget.downAllThresholds = threshold;
        widget.redraw();
      });
    }

    // Create list of selected neurons
    var neuronTable = $('<table />').attr('class', 'header left')
          .append($('<thead />').append($('<tr />')
              .append($('<th />'))
              .append($('<th />').text('Selected').append(selectAllCb))
              .append($('<th />').text('Neuron'))
              .append(upThresholdHeader)
              .append(downThresholdHeader)));
    // Add a row for each neuron looked at
    this.ordered_skeleton_ids.forEach(function(skid, i) {
      var id = this.widgetID + '-' + skid;
      var $upThrSelector = createThresholdSelector('neuron-up-threshold-' + id,
          this.upThresholds[skid] || 1, 21);
      var $downThrSelector = createThresholdSelector('neuron-down-threshold-' + id,
          this.downThresholds[skid] || 1, 21);
      // Create and attach handlers to threshold selectors. Generate the function
      // to avoid the creation of a closure.
      $upThrSelector.change((function(widget, skid) {
        return function() {
          widget.upThresholds[skid] = parseInt(this.value);
          widget.redraw();
        };
      })(this, skid));
      $downThrSelector.change((function(widget, skid) {
        return function() {
          widget.downThresholds[skid] = parseInt(this.value);
          widget.redraw();
        };
      })(this, skid));

      // Make a neuron selected by default
      if (!(skid in this.skeletonSelection)) {
        this.skeletonSelection[skid] = true;
      }

      // Create a selection checkbox
      var selectionCb = $('<input />')
          .attr('id', 'neuron-selector-' + id)
          .attr('type', 'checkbox')
          .change(function(widget, neuronId) {
            return function() {
              widget.selectSkeleton(skid, this.checked);
            };
          }(this, skid));
      if (this.skeletonSelection[skid]) {
          selectionCb.prop('checked', true);
      }

      // Create small icon to remove this neuron from list
      var removeSkeleton = $('<span />')
        .attr('class', 'ui-icon ui-icon-close remove-skeleton')
        .attr('title', 'Remove this neuron from list')
        .attr('skid', skid);

      // Create and append row for current skeleton
      var row = $('<tr />')
          .append($('<td />').append((i + 1) + '.').append(removeSkeleton))
          .append($('<td />').attr('class', 'input-container')
              .append(selectionCb))
          .append($('<td />').append(
              createNameElement(this.skeletons[skid], skid)))
          .append($('<td />').append($upThrSelector)
              .attr('class', 'input-container'))
          .append($('<td />').append($downThrSelector)
              .attr('class', 'input-container'));
      neuronTable.append(row);
    }, this);
    content.append(neuronTable);

    neuronTable.on('click', '.remove-skeleton', this, function (e) {
          e.data.removeSkeletons([parseInt($(this).attr('skid'), 10)]);
        });

    // Check the select all box, if all skeletons are selected
    var notSelected = function(skid) {
      return !this.skeletonSelection[skid];
    };
    selectAllCb.prop('checked', !this.ordered_skeleton_ids.some(notSelected, this));

    // If there is more than one neuron looked at, add a sum row
    if (this.ordered_skeleton_ids.length > 1) {
      var id = this.widgetID + '-sum';
      var $upThrSelector = createThresholdSelector('neuron-up-threshold-' + id,
          this.upThresholds['sum'] || 1, 21);
      var $downThrSelector = createThresholdSelector('neuron-down-threshold-' + id,
          this.downThresholds['sum'] || 1, 21);
      // Create and attach handlers to threshold selectors. Generate the function
      // to avoid the creation of a closure.
      $upThrSelector.change((function(widget) {
        return function() {
          widget.upThresholds['sum'] = parseInt(this.value);
          widget.createConnectivityTable();
        };
      })(this));
      $downThrSelector.change((function(widget, skid) {
        return function() {
          widget.downThresholds['sum'] = parseInt(this.value);
          widget.createConnectivityTable();
        };
      })(this));
      // Create and append footer for current skeleton
      var row = $('<tfoot />').append($('<tr />')
          .append($('<td />'))
          .append($('<td />'))
          .append($('<td />').text('Sum'))
          .append($('<td />').append($upThrSelector)
              .attr('class', 'input-container'))
          .append($('<td />').append($downThrSelector)
              .attr('class', 'input-container')));
      neuronTable.append(row);
    }

    // Add a separate table settings container
    var tableSettings = $('<div />').attr('class', 'header');
    content.append(tableSettings);

    // Add an input to filter partners with fewer than a given number of nodes.
    var hidePartnerThresholdInput = $('<input />')
        .attr('type', 'number')
        .attr('min', 0)
        .attr('max', 999999)
        .val(this.hidePartnerThreshold)
        .get(0);

    (function (widget) {
      hidePartnerThresholdInput.onchange = function () {
          widget.hidePartnerThreshold = parseInt(this.value, 10);
          widget.createConnectivityTable();
      };
      hidePartnerThresholdInput.oninput = function (e) {
        if (13 === e.keyCode) {
          widget.createConnectivityTable();
        } else {
          widget.hidePartnerThreshold = parseInt(this.value, 10);
        }
      };
      hidePartnerThresholdInput.onwheel = function (e) {
          if ((e.deltaX + e.deltaY) > 0) {
            if (this.value > 1) {
              this.value = parseInt(this.value, 10) - 1;
              this.onchange();
            }
          } else {
            this.value = parseInt(this.value, 10) + 1;
            this.onchange();
          }

          return false;
      };
    })(this);

    var hidePartnerThresholdContainer = $('<label />')
        .attr('class', 'left')
        .append('Hide partners with fewer nodes than')
        .append(hidePartnerThresholdInput);
    tableSettings.append(hidePartnerThresholdContainer);

    // Add a drop-down menu to select a review focus. It defaults to 'Union'
    // if nothing else was selected before.
    var reviewFilter = $('<select />')
        .append($('<option />').attr('value', 'union').append('All (union)').prop('selected', this.reviewFilter === null))
        .change((function(widget) {
          return function() {
            widget.reviewFilter = this.value === 'union' ? null : this.value;
            widget.updateReviewSummaries();
          };
        })(this));

    // Build select options
    var reviewerNames = {};
    this.reviewers.forEach(function(r) {
      var u = User.all()[r];
      reviewerNames[u ? u.fullName : r] = r;
    });
    reviewerNames['Team'] = 'whitelist';
    var displayOrder = Object.keys(reviewerNames).sort();
    displayOrder.unshift('Team');
    displayOrder.forEach(function (displayName) {
      var r = reviewerNames[displayName];
      var opt = $('<option />').attr('value', r).append(displayName);
      if (this.reviewFilter === r) {
        opt.prop('selected', true);
      }
      reviewFilter.append(opt);
    }, this);
    var reviewFilterContainer = $('<label />')
        .attr('class', 'right')
        .append('Reviewed by')
        .append(reviewFilter);
    tableSettings.append(reviewFilterContainer);

    // Create containers for pre and postsynaptic partners
    var incoming = $('<div />');
    var outgoing = $('<div />');
    var tables = $('<div />').css('width', '100%').attr('class', 'content')
       .append(incoming)
       .append(outgoing);
    content.append(tables);

    // Add handler to layout toggle
    $('#connectivity-layout-toggle-' + widgetID).unbind('change')
        .change((function(widget) {
          return function() {
            widget.tablesSideBySide = this.checked;
            layoutTables(this.checked);
          };
        })(this)).change();

    // Create incomining and outgoing tables
    var table_incoming = create_table.call(this, this.ordered_skeleton_ids,
        this.skeletons, this.upThresholds, to_sorted_array(this.incoming),
        'Up', 'presynaptic_to', this.hidePartnerThreshold, this.reviewFilter,
        this.upstreamCollapsed, (function() {
          this.upstreamCollapsed = !this.upstreamCollapsed;
        }).bind(this));
    var table_outgoing = create_table.call(this, this.ordered_skeleton_ids,
        this.skeletons, this.downThresholds, to_sorted_array(this.outgoing),
        'Down', 'postsynaptic_to', this.hidePartnerThreshold, this.reviewFilter,
        this.downstreamCollapsed, (function() {
          this.downstreamCollapsed = !this.downstreamCollapsed;
        }).bind(this));

    // Extend tables with DataTables for sorting, reordering and filtering
    var dataTableOptions = {
      aaSorting: [[2, 'desc']],
      bDestroy: true,
      sDom: 'Rl<"connectivity_table_actions">rti',
      bFilter: true,
      bPaginate: false,
      bProcessing: true,
      bServerSide: false,
      bAutoWidth: false,
      iDisplayLength: -1,
      oColReorder: {
        iFixedColumns: 1
      },
      aoColumnDefs: [
        { aTargets: [0], sSortDataType: 'dom-checkbox' }, // Checkbox column
        { aTargets: [1], sType: 'html', bSearchable: true }, // Neuron name column
        { aTargets: ['_all'], sType: 'html-num-fmt', bSearchable: false } // All other columns
      ]
    };

    incoming.append(table_incoming);
    outgoing.append(table_outgoing);

    table_incoming.dataTable(dataTableOptions);
    table_outgoing.dataTable(dataTableOptions);

    $('.dataTables_wrapper', tables).css('min-height', 0);

    $.each([table_incoming, table_outgoing], function () {
      var self = this;
      $(this).siblings('.connectivity_table_actions')
        // Add custom filter/search input to support regular expressions.
        .append($('<div class="dataTables_filter">')
          .append($('<label />')
            .text('Filter partners:')
            .append($('<input type="search" />').on('keyup', function () {
              var search = this.value;
              if (search.length > 0 && search[0] === '/') {
                // Treat the input as regex.
                // Trim regex delimiters from search string.
                search = search.slice(1, search[search.length - 1] === '/' ? search.length - 1 : undefined);
                try {
                  var re = new RegExp(search);
                  // Regex is valid
                  $(this).removeClass('ui-state-error');
                  self.DataTable().search(search, true, false).draw();
                } catch (error) {
                  $(this).addClass('ui-state-error');
                }
              } else {
                // Treat the search as plain text input. Use DataTables' smart search.
                $(this).removeClass('ui-state-error');
                self.DataTable().search(search, false, true).draw();
              }
            }))
          )
        )
        // Add table export buttons.
        .append($('<div class="dataTables_export"></div>').append(
          $('<input type="button" value="Export CSV" />').click(function () {
            var text = self.fnSettings().aoHeader.map(function (r) {
              return r.map(cellToText.bind(this, true))
                .filter(function(c, i) { return i > 0; }).join(',');
            }).join('\n');
            text += '\n' + self.fnGetData().map(function (r) {
              return r.map(cellToText.bind(this, false))
                .filter(function(c, i) { return i > 0; }).join(',');
            }).join('\n');
            saveAs(new Blob([text], {type: 'text/plain'}), 'connectivity.csv');
          })
        )
      );
    });

    this.updateReviewSummaries();

    // Add a handler for openening connector selections for individual partners

    incoming.on('click', 'a[partnerID]', createPartnerClickHandler(
          this.incoming, 'presynaptic_to'));
    outgoing.on('click', 'a[partnerID]', createPartnerClickHandler(
          this.outgoing, 'postsynaptic_to'));
    function createPartnerClickHandler(partners, relation) {
      return function() {
        var partnerID = $(this).attr('partnerID');
        var partner = partners[partnerID];
        if (!partner) {
          CATMAID.error("Could not find partner with ID " + partnerID +
              " and relation " + relation);
        } else {
          var skids = Object.keys(partner.skids);
          CATMAID.ConnectorSelection.show_shared_connectors([partner.id], skids, relation);
        }

        return true;
      };
    }

    // Add 'select all' checkboxes
    var nSkeletons = Object.keys(this.skeletons).length;
    add_select_all_fn(this, 'up', table_incoming, nSkeletons);
    add_select_all_fn(this, 'down', table_outgoing, nSkeletons);

    // Add handler for individual skeleton checkboxes
    incoming.on('click', 'input[data-skeleton-id][type=checkbox]',
       set_as_selected.bind(this, 'up', 'presynaptic_to'));
    outgoing.on('click', 'input[data-skeleton-id][type=checkbox]',
       set_as_selected.bind(this, 'down', 'postsynaptic_to'));

    // Add handler for neuron name clicks
    content.off('click', 'a[data-skeleton-id]');
    content.on('click', 'a[data-skeleton-id]', function() {
      var skeletonId = this.dataset.skeletonId;
      CATMAID.TracingTool.goToNearestInNeuronOrSkeleton('skeleton', skeletonId);
      return false;
    });

    /**
     * Return a quoted string representation of table cell content.
     */
    function cellToText(useCell, c) {
      try {
        c = useCell ? c.cell : c;
        return '"' + ($(c).text() || c) + '"';
      } catch (e) {
        return '"' + c + '"';
      }
    }

    /**
     * Helper to handle selection of a neuron.
     */
    function set_as_selected(name, relation, ev) {
      var skelid = parseInt( ev.target.value );
      var checked = ev.target.checked;
      /* jshint validthis: true */
      this.selectSkeleton(skelid, checked);

      // Uncheck the select-all checkbox if it is checked and this checkbox is
      // now unchecked
      if (!checked) {
        $('#' + name + 'stream-selectall' + widgetID + ':checked')
            .prop('checked', false);
      }
    }
  };

  SkeletonConnectivity.prototype.openPlot = function() {
    if (0 === Object.keys(this.skeletons).length) {
      alert("Load at least one skeleton first!");
      return;
    }
    // Create a new connectivity graph plot and hand it to the window maker to
    // show it in a new widget.
    var GP = new ConnectivityGraphPlot(this.skeletons, this.incoming,
        this.outgoing);
    WindowMaker.create('connectivity-graph-plot', GP);
    GP.draw();
  };

  /**
   * A small widget to display a graph, plotting the number of upstream/downstream
   * partners against the number of synapses. A list of skeleton_ids has to be
   * passed to the constructor to display plots for these skeletons right away.
   */
  var ConnectivityGraphPlot = function(skeletons, incoming, outgoing) {
    this.skeletons = skeletons;
    this.incoming = incoming;
    this.outgoing = outgoing;
    this.widgetID = this.registerInstance();
  };

  ConnectivityGraphPlot.prototype = {};
  $.extend(ConnectivityGraphPlot.prototype, new InstanceRegistry());

  /**
   * Return name of this widget.
   */
  ConnectivityGraphPlot.prototype.getName = function() {
    return "Connectivity Graph Plot " + this.widgetID;
  };

  /**
   * Custom destroy handler, that deletes all fields of this instance when called.
   */
  ConnectivityGraphPlot.prototype.destroy = function() {
    this.unregisterInstance();
    Object.keys(this).forEach(function(key) { delete this[key]; }, this);
  };

  /**
   * Custom resize handler, that redraws the graphs when called.
   */
  ConnectivityGraphPlot.prototype.resize = function() {
    this.draw();
  };

  /**
   * Makes the browser download the upstream and downstream SVGs as two separate
   * files.
   */
  ConnectivityGraphPlot.prototype.exportSVG = function() {
    var div = document.getElementById('connectivity_graph_plot_div' + this.widgetID);
    if (!div) return;
    var images = div.getElementsByTagName('svg');
    if (0 === images.length) return;
    // Export upstream image
    var xml = new XMLSerializer().serializeToString(images[0]);
    var blob = new Blob([xml], {type : 'text/xml'});
    saveAs(blob, 'upstream_connectivity_chart.svg');
    // Export downstream image
    if (1 === images.length) return;
    xml = new XMLSerializer().serializeToString(images[1]);
    blob = new Blob([xml], {type : 'text/xml'});
    saveAs(blob, 'downstream_connectivity_chart.svg');
  };

  /**
   * Creates two distribution d3 plots, one for up stream and the other ones for
   * downstream neurons.
   */
  ConnectivityGraphPlot.prototype.draw = function() {
    /**
     * Generate a distribution of number of Y partners that have X synapses, for
     * each partner. The distribution then takes the form of an array of blocks,
     * where every block is an array of objects like {skid: <skeleton_id>,
     * count: <partner count>}.  The skeleton_node_count_threshold is used to
     * avoid skeletons whose node count is too small, like e.g. a single node.
     */
    var distribution = function(partners, skeleton_node_count_threshold, skeletons) {
      var d = Object.keys(partners)
          .reduce(function(ob, partnerID) {
            var props = partners[partnerID];
            if (props.num_nodes < skeleton_node_count_threshold) {
              return ob;
            }
            var skids = props.skids;
            return Object.keys(skids)
                .reduce(function(ob, skid) {
                  if (!ob.hasOwnProperty(skid)) ob[skid] = [];
                  var synapse_count = skids[skid];
                  if (!ob[skid].hasOwnProperty(synapse_count)) {
                    ob[skid][synapse_count] = 1;
                  } else {
                    ob[skid][synapse_count] += 1;
                  }
                  return ob;
                }, ob);
            }, {});

      // Find out which is the longest array
      var max_length = Object.keys(d).reduce(function(length, skid) {
        return Math.max(length, d[skid].length);
      }, 0);

      /* Reformat to an array of arrays where the index of the array is the
       * synaptic count minus 1 (arrays are zero-based), and each inner array
       * has objects with {series, count} keys. */
      var a = [];
      var skids = Object.keys(d);
      for (var i = 1; i < max_length; ++i) {
        a[i-1] = skids.reduce(function(block, skid) {
          var count = d[skid][i];
          if (count) block.push({series: skeletons[skid], count: count});
          return block;
        }, []);
      }

      return a;
    };

    /**
     * A multiple bar chart that shows the number of synapses vs the number of
     * partners that receive/make that many synapses from/onto the skeletons
     * involved (the active or the selected ones).
     */
    var makeMultipleBarChart = function(skeletons, partners, container, title, widgetID, container_width) {
      // Cancel drawing if there is no data
      if (0 === Object.keys(partners).length) return null;

      // Prepare data: (skip skeletons with less than 2 nodes)
      var a = distribution(partners, 2, skeletons);

      // The names of the skeletons involved
      var names = Object.keys(a.reduce(function(unique, block) {
        if (block) block.forEach(function(ob) { unique[ob.series] = null; });
        return unique;
      }, {}));

      if (0 === names.length) return null;

      // Colors: an array of hex values
      var colorizer = d3.scale.category10(),
          colors = names.map(function(_, i) { return colorizer(i); });

      // Don't let the canvas be less than 400px wide
      if (container_width < 400) {
        container_width = 400;
      }

      var width = container_width,
          height = container_width / 2,
          id = "connectivity_plot_" + title + widgetID;

      CATMAID.svgutil.insertMultipleBarChart(container, id, width, height,
          "N synapses", "N " + title + " Partners",
          names, a, colors,
          a.map(function(block, i) { return i+1; }));
    };

    // Clear existing plot, if any
    var containerID = '#connectivity_graph_plot_div' + this.widgetID;
    var container = $(containerID);
    container.empty();

    // Draw plots
    makeMultipleBarChart(this.skeletons, this.incoming, containerID,
        "Upstream", this.widgetID, container.width());
    makeMultipleBarChart(this.skeletons, this.outgoing, containerID,
        "Downstream", this.widgetID, container.width());
  };

  // Make skeleton connectivity widget available in CATMAID namespace
  CATMAID.SkeletonConnectivity = SkeletonConnectivity;

})(CATMAID);
