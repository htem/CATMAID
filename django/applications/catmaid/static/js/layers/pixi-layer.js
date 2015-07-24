/* -*- mode: espresso; espresso-indent-level: 2; indent-tabs-mode: nil -*- */

(function(CATMAID) {

  "use strict";

  PixiLayer.contexts = new Map();

  /**
   * A WebGL/Pixi context shared by all WebGL layers in the same stack viewer.
   *
   * @class PixiContext
   * @constructor
   * @param {StackViewer} stackViewer The stack viewer to which this context belongs.
   */
  function PixiContext(stackViewer) {
    this.renderer = new PIXI.autoDetectRenderer(
        stackViewer.getView().clientWidth,
        stackViewer.getView().clientHeight);
    this.stage = new PIXI.Stage(0x000000);
    this.layersRegistered = new Set();
  }

  /**
   * Release any Pixi resources owned by this context.
   */
  PixiContext.prototype.destroy = function () {
    this.renderer.destroy();
  };

  /**
   * Mark all layers using this context as not being ready for rendering.
   */
  PixiContext.prototype.resetRenderReadiness = function () {
    this.layersRegistered.forEach(function (layer) {
      layer.readyForRender = false;
    });
  };

  /**
   * Render the Pixi context if all layers using it are ready.
   */
  PixiContext.prototype.renderIfReady = function () {
    var allReady = true;
    this.layersRegistered.forEach(function (layer) {
        allReady = allReady && (layer.readyForRender || !layer.visible);
    });

    if (allReady) this.renderer.render(this.stage);
  };


  /**
   * A layer that shares a common Pixi renderer with other layers in this stack
   * viewer. Creates a renderer and stage context for the stack viewer if none
   * exists.
   *
   * Must be used as a mixin for an object with a `stackViewer` property.
   *
   * @class PixiLayer
   * @constructor
   */
  function PixiLayer() {
    this.batchContainer = null;
    this._context = PixiLayer.contexts.get(this.stackViewer);
    if (!this._context) {
      if (!PIXI.BaseTextureCacheManager || PIXI.BaseTextureCacheManager.constructor !== PIXI.LRUCacheManager) {
        PIXI.BaseTextureCacheManager = new PIXI.LRUCacheManager(PIXI.BaseTextureCache, 512);
      }
      this._context = new PixiContext(this.stackViewer);
      PixiLayer.contexts.set(this.stackViewer, this._context);
    }
    this._context.layersRegistered.add(this);
    this.renderer = this._context.renderer;
    this.stage = this._context.stage;
    this.blendMode = 'normal';
    this.filters = [];
    this.readyForRender = false;
  }

  /**
   * Free any pixi display objects associated with this layer.
   */
  PixiLayer.prototype.unregister = function () {
    if (this.batchContainer) {
      this.batchContainer.removeChildren();
      this.stage.removeChild(this.batchContainer);
    }

    this._context.layersRegistered.delete(this);

    // If this was the last layer using this Pixi context, remove it.
    if (this._context.layersRegistered.size === 0) {
      this._context.destroy();
      PixiLayer.contexts.delete(this.stackViewer);
    }
  };

  /**
   * Initialise the layer's batch container.
   */
  PixiLayer.prototype._initBatchContainer = function () {
    if (!this.batchContainer) {
      this.batchContainer = new PIXI.DisplayObjectContainer();
      this.syncFilters();
      this.stage.addChild(this.batchContainer);
    } else this.batchContainer.removeChildren();
  };

  /**
   * Render the Pixi context if all layers using it are ready.
   */
  PixiLayer.prototype._renderIfReady = function () {
    this.readyForRender = true;
    this._context.renderIfReady();
  };

  /**
   * Set opacity in the range from 0 to 1.
   * @param {number} val New opacity.
   */
  PixiLayer.prototype.setOpacity = function (val) {
    this.opacity = val;
    this.visible = val >= 0.02;
    if (this.batchContainer) {
      this.batchContainer.alpha = val;
      this.batchContainer.visible = this.visible;
    }
  };

  /**
   * Notify this layer that it has been reordered to be before another layer.
   * While the stack viewer orders DOM elements, layers are responsible for any
   * internal order representation, such as in a scene graph.
   * @param  {Layer} beforeLayer The layer which this layer was inserted before,
   *                             or null if this layer was moved to the end (top).
   */
  PixiLayer.prototype.notifyReorder = function (beforeLayer) {
    // PixiLayers can only reorder around other PixiLayers, since their ordering
    // is independent of the DOM. Use batchContainer to check for PixiLayers,
    // since instanceof does not work with MI/mixin inheritance.
    if (!(beforeLayer === null || beforeLayer.batchContainer)) return;

    var newIndex = beforeLayer === null ?
        this.stage.children.length - 1 :
        this.stage.getChildIndex(beforeLayer.batchContainer);
    this.stage.setChildIndex(this.batchContainer, newIndex);
  };

  /**
   * Retrieve blend modes supported by this layer.
   * @return {string[]} Names of supported blend modes.
   */
  PixiLayer.prototype.getAvailableBlendModes = function () {
    var normBlendFuncs = PIXI.blendModesWebGL[PIXI.blendModes.NORMAL];
    return Object.keys(PIXI.blendModes)
        .filter(function (modeKey) { // Filter modes that are not different from normal.
          var glBlendFuncs = PIXI.blendModesWebGL[PIXI.blendModes[modeKey]];
          return modeKey == 'NORMAL' ||
              glBlendFuncs[0] !== normBlendFuncs[0] ||
              glBlendFuncs[1] !== normBlendFuncs[1]; })
        .map(function (modeKey) {
          return modeKey.toLowerCase().replace(/_/, ' '); });
  };

  /**
   * Return the current blend mode for this layer.
   * @return {string} Name of the current blend mode.
   */
  PixiLayer.prototype.getBlendMode = function () {
    return this.blendMode;
  };

  /**
   * Set the current blend mode for this layer.
   * @param {string} modeKey Name of the blend mode to use.
   */
  PixiLayer.prototype.setBlendMode = function (modeKey) {
    this.blendMode = modeKey;
    modeKey = modeKey.replace(/ /, '_').toUpperCase();
    this.batchContainer.children.forEach(function (child) {
      child.blendMode = PIXI.blendModes[modeKey];
    });
  };

  /**
   * Retrieve filters supported by this layer.
   * @return {Object.<string,function>} A map of filter names to constructors.
   */
  PixiLayer.prototype.getAvailableFilters = function () {
    // PIXI Canvas renderer does not currently support filters.
    if (this.renderer instanceof PIXI.CanvasRenderer) return {};

    return {
      'Gaussian Blur': PixiLayer.FilterWrapper.bind(null, 'Gaussian Blur', PIXI.BlurFilter, [
        {displayName: 'Width (px)', name: 'blurX', type: 'slider', range: [0, 32]},
        {displayName: 'Height (px)', name: 'blurY', type: 'slider', range: [0, 32]}
      ], this),
      'Invert': PixiLayer.FilterWrapper.bind(null, 'Invert', PIXI.InvertFilter, [
        {displayName: 'Strength', name: 'invert', type: 'slider', range: [0, 1]}
      ], this),
      'Brightness, Contrast & Saturation': PixiLayer.FilterWrapper.bind(null, 'Brightness, Contrast & Saturation', PixiLayer.Filters.BrightnessContrastSaturationFilter, [
        {displayName: 'Brightness', name: 'brightness', type: 'slider', range: [0, 3]},
        {displayName: 'Contrast', name: 'contrast', type: 'slider', range: [0, 3]},
        {displayName: 'Saturation', name: 'saturation', type: 'slider', range: [0, 3]}
      ], this),
      'Color Transform': PixiLayer.FilterWrapper.bind(null, 'Color Transform', PIXI.ColorMatrixFilter, [
        {displayName: 'RGBA Matrix', name: 'matrix', type: 'matrix', size: [4, 4]}
      ], this),
      'Intensity Thresholded Transparency': PixiLayer.FilterWrapper.bind(null, 'Intensity Thresholded Transparency', PixiLayer.Filters.IntensityThresholdTransparencyFilter, [
        {displayName: 'Intensity Threshold', name: 'intensityThreshold', type: 'slider', range: [0, 1]},
        {displayName: 'Luminance Coefficients', name: 'luminanceCoeff', type: 'matrix', size: [1, 3]}
      ], this),
    };
  };

  /**
   * Retrieve the set of active filters for this layer.
   * @return {[]} The collection of active filter objects.
   */
  PixiLayer.prototype.getFilters = function () {
    return this.filters;
  };

  /**
   * Update filters in the renderer to match filters set for the layer.
   */
  PixiLayer.prototype.syncFilters = function () {
    if (this.filters.length > 0)
      this.batchContainer.filters = this.filters.map(function (f) { return f.pixiFilter; });
    else
      this.batchContainer.filters = null;
  };

  /**
   * Add a filter to the set of active filters for this layer.
   * @param {Object} filter The filter object to add.
   */
  PixiLayer.prototype.addFilter = function (filter) {
    this.filters.push(filter);
    this.syncFilters();
  };

  /**
   * Remove a filter from the set of active filters for this layer.
   * @param  {Object} filter The filter object to remove.
   */
  PixiLayer.prototype.removeFilter = function (filter) {
    var index = this.filters.indexOf(filter);
    if (index === -1) return;
    this.filters.splice(index, 1);
    this.syncFilters();
  };

  /**
   * Change the rendering order for a filter of this layer.
   * @param  {number} currIndex Current index of the filter to move.
   * @param  {number} newIndex  New insertion index of the filter to move.
   */
  PixiLayer.prototype.moveFilter = function (currIndex, newIndex) {
    this.filters.splice(newIndex, 0, this.filters.splice(currIndex, 1)[0]);
    this.syncFilters();
  };

  /**
   * A wrapper for PixiJS WebGL filters to provide the control and UI for use as
   * a layer filter.
   * @constructor
   * @param {string} displayName      Display name of this filter in interfaces.
   * @param {function(new:PIXI.AbstractFilter)} pixiConstructor
   *                                  Constructor for the underlying Pixi filter.
   * @param {[]} params               Parameters to display in control UI and
   *                                  their mapping to Pixi properties.
   * @param {CATMAID.TileLayer} layer The layer to which this filter belongs.
   */
  PixiLayer.FilterWrapper = function (displayName, pixiConstructor, params, layer) {
    this.displayName = displayName;
    this.pixiFilter = new pixiConstructor();
    this.params = params;
    this.layer = layer;
  };

  PixiLayer.FilterWrapper.prototype = {};
  PixiLayer.FilterWrapper.constructor = PixiLayer.FilterWrapper;

  /**
   * Set a filter parameter.
   * @param {[type]} key   Name of the parameter to set.
   * @param {[type]} value New value for the parameter.
   */
  PixiLayer.FilterWrapper.prototype.setParam = function (key, value) {
    this.pixiFilter[key] = value;
    if (this.layer) this.layer.redraw();
  };

  /**
   * Draw control UI for the filter and its parameters.
   * @param  {JQuery}   container Element where the UI will be inserted.
   * @param  {Function} callback  Callback when parameters are changed.
   */
  PixiLayer.FilterWrapper.prototype.redrawControl = function (container, callback) {
    container.append('<h5>' + this.displayName + '</h5>');
    for (var paramIndex = 0; paramIndex < this.params.length; paramIndex++) {
      var param = this.params[paramIndex];

      switch (param.type) {
        case 'slider':
          var slider = new CATMAID.Slider(
              CATMAID.Slider.HORIZONTAL,
              true,
              param.range[0],
              param.range[1],
              201,
              this.pixiFilter[param.name],
              this.setParam.bind(this, param.name));
          var paramSelect = $('<div class="setting"/>');
          paramSelect.append('<span>' + param.displayName + '</span>');
          paramSelect.append(slider.getView());
          // TODO: fix element style. Slider should use CSS.
          var inputView = $(slider.getInputView());
          inputView.css('display', 'inline-block').css('margin', '0 0.5em');
          inputView.children('img').css('vertical-align', 'middle');
          paramSelect.append(inputView);
          container.append(paramSelect);
          break;

        case 'matrix':
          var mat = this.pixiFilter[param.name];
          var matTable = $('<table />');
          var setParam = this.setParam.bind(this, param.name);
          var setMatrix = function () {
            var newMat = [];
            var inputInd = 0;
            matTable.find('input').each(function () {
              newMat[inputInd++] = $(this).val();
            });
            setParam(newMat);
          };

          for (var i = 0; i < param.size[0]; ++i) {
            var row = $('<tr/>');
            for (var j = 0; j < param.size[1]; ++j) {
              var ind = i*param.size[1] + j;
              var cell = $('<input type="number" step="0.1" value="' + mat[ind] + '"/>');
              cell.change(setMatrix);
              cell.css('width', '4em');
              row.append($('<td/>').append(cell));
            }
            matTable.append(row);
          }

          var paramSelect = $('<div class="setting"/>');
          paramSelect.append('<span>' + param.displayName + '</span>');
          paramSelect.append(matTable);
          container.append(paramSelect);
          break;
      }
    }
  };

  /**
   * Custom Pixi/WebGL filters.
   */
  PixiLayer.Filters = {};

  /**
   * This filter allows basic linear brightness, contrast and saturation
   * adjustments in RGB space.
   * @constructor
   */
  PixiLayer.Filters.BrightnessContrastSaturationFilter = function () {
    PIXI.AbstractFilter.call(this);

    this.passes = [this];

    this.uniforms = {
      brightness: {type: '1f', value: 1},
      contrast: {type: '1f', value: 1},
      saturation: {type: '1f', value: 1}
    };

    this.fragmentSrc = [
        'precision mediump float;',
        'uniform float brightness;',
        'uniform float contrast;',
        'uniform float saturation;',

        'varying vec2 vTextureCoord;',
        'uniform sampler2D uSampler;',

        'const vec3 luminanceCoeff = vec3(0.2125, 0.7154, 0.0721);',
        'const vec3 noContrast = vec3(0.5, 0.5, 0.5);',

        'void main(void) {',
        '  vec4 frag = texture2D(uSampler, vTextureCoord);',
        '  vec3 color = frag.rgb;',

        '  color = color * brightness;',
        '  float intensityMag = dot(color, luminanceCoeff);',
        '  vec3 intensity = vec3(intensityMag, intensityMag, intensityMag);',
        '  color = mix(intensity, color, saturation);',
        '  color = mix(noContrast, color, contrast);',

        '  frag.rgb = color;',
        '  gl_FragColor = frag;',
        '}'
    ];
  };

  PixiLayer.Filters.BrightnessContrastSaturationFilter.prototype = Object.create(PIXI.AbstractFilter.prototype);
  PixiLayer.Filters.BrightnessContrastSaturationFilter.prototype.constructor = PixiLayer.Filters.BrightnessContrastSaturationFilter;

  ['brightness', 'contrast', 'saturation'].forEach(function (prop) {
    Object.defineProperty(PixiLayer.Filters.BrightnessContrastSaturationFilter.prototype, prop, {
      get: function () {
        return this.uniforms[prop].value;
      },
      set: function (value) {
        this.uniforms[prop].value = value;
      }
    });
  });

  /**
   * This filter makes pixels transparent according to an intensity threshold.
   * The luminance projection used to determine intensity is configurable.
   * @constructor
   */
  PixiLayer.Filters.IntensityThresholdTransparencyFilter = function () {
    PIXI.AbstractFilter.call(this);

    this.passes = [this];

    this.uniforms = {
      luminanceCoeff: {type: '3fv', value: [0.2125, 0.7154, 0.0721]},
      intensityThreshold: {type: '1f', value: 0.01}
    };

    this.fragmentSrc = [
        'precision mediump float;',
        'uniform vec3 luminanceCoeff;',
        'uniform float intensityThreshold;',

        'varying vec2 vTextureCoord;',
        'uniform sampler2D uSampler;',

        'void main(void) {',
        '  vec4 frag = texture2D(uSampler, vTextureCoord);',
        '  vec3 color = frag.rgb;',
        '  float intensityMag = dot(color, luminanceCoeff);',

        '  frag.a = min(step(intensityThreshold, intensityMag), frag.a);',
        '  frag.rgb = frag.rgb * frag.a;', // Use premultiplied RGB
        '  gl_FragColor = frag;',
        '}'
    ];
  };

  PixiLayer.Filters.IntensityThresholdTransparencyFilter.prototype = Object.create(PIXI.AbstractFilter.prototype);
  PixiLayer.Filters.IntensityThresholdTransparencyFilter.prototype.constructor = PixiLayer.Filters.IntensityThresholdTransparencyFilter;

  ['luminanceCoeff', 'intensityThreshold'].forEach(function (prop) {
    Object.defineProperty(PixiLayer.Filters.IntensityThresholdTransparencyFilter.prototype, prop, {
      get: function () {
        return this.uniforms[prop].value;
      },
      set: function (value) {
        this.uniforms[prop].value = value;
      }
    });
  });

  CATMAID.PixiLayer = PixiLayer;

  CATMAID.Init.on(CATMAID.Init.EVENT_PROJECT_CHANGED,
      function (project) {
        project.on(Project.EVENT_STACKVIEW_CLOSED,
            function (stackViewer) {
              var context = PixiLayer.contexts.get(stackViewer);
              if (context) {
                context.renderer.destroy();
                PixiLayer.contexts.delete(stackViewer);
              }
            });
      });

})(CATMAID);
