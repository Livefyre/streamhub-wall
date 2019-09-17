define([
  'streamhub-sdk/jquery',
  'streamhub-sdk/content/views/content-list-view',
  'streamhub-sdk/content/views/content-view',
  'css!./styles/wall-view.css',
  'inherits',
  './package-attribute',
  'css!streamhub-sdk/css/style.css'
], function ($, ContentListView, ContentView, MEDIA_WALL_CSS, inherits, packageAttribute, sdkStyles) {
  'use strict';

  /**
   * A view that displays Content in a media wall.
   * @param opts {Object} A set of options to config the view with
   * @param opts.el {HTMLElement} The element in which to render the streamed content
   * @param opts.relayoutWait {number} The number of milliseconds to wait when debouncing
   *        .relayout(). Defaults to 200ms.
   * @param opts.css {boolean} Whether to insert default media wall css. Default true.
   * @constructor
   */
  var MediaWallView = function (opts) {
    var self = this;
    opts = opts || {};

    this._id = new Date().getTime();
    this._autoFitColumns = true;
    this._contentWidth = opts.minContentWidth || 300;
    this._collection = opts.collection;
    this._columnViews = [];
    this._containerInnerWidth = null;
    this._columnHeights = {};
    this._numberOfColumns = null;
    this._animate = opts.animate === undefined ? true : opts.animate;
    this._pickColumnIndex = opts.pickColumn || MediaWallView.columnPickers.roundRobin;
    this._constrainAttachmentsByWidth = opts.constrainAttachmentsByWidth || false;
    this._modal = opts.modal;

    this.debouncedRelayout = debounce(function () {
      var numColumnsChanged = self.fitColumns();
      if (numColumnsChanged) {
        self.relayout();
      }
    }, opts.debounceRelayout || 200);

    if (opts.columns && typeof opts.columns === 'number') {
      this._autoFitColumns = false;
      this.setColumns(opts.columns);
    }

    // Tells `hasAttachmentModal` within `ContentListView` to use the new modal
    // when the `focusContent.hub` event is triggered instead of just showing
    // the content media within a modal.
    opts.useNewModal = true;
    opts.useSingleMediaView = true;

    ContentListView.call(this, opts);

    if (this.modal) {
      // Patch the modal so that it has the right package selector when it
      // is shown (like data-lf-package="streamhub-wall#3.0.0")
      packageAttribute.decorateModal(this.modal);
    }

    this._onWindowResize = function (e) {
      if (self._autoFitColumns) {
        self.debouncedRelayout();
      }
    };
    $(window).on('resize', this._onWindowResize);

    opts.css = (typeof opts.css === 'undefined') ? true : opts.css;

    if (this._autoFitColumns) {
      this.fitColumns();
    }
  };
  inherits(MediaWallView, ContentListView);

  MediaWallView.prototype.mediaWallClassName = 'streamhub-media-wall-view';
  MediaWallView.prototype.columnClassName = 'hub-wall-column';
  MediaWallView.prototype.fitToWidthClassName = 'content-fit-to-width';

  MediaWallView.columnPickers = {
    roundRobin: function (contentView, forcedIndex) {
      var cols = this._numberOfColumns;

      // If "show more" has not been used, the number of columns to use
      // in the round robin should be limited to the smaller of:
      //   1. number of comments to load initially
      //   2. maximum number of columns
      //
      // `_bound` is an instance variable in `ContentListView` that
      // determines whether the count of content is bound by a number.
      // Initially it is true since the initial count is set, but when
      // "show more" is fired, it is false, so that content will flow in
      // and not check if there is space in the view.
      if (this._bound) {
        var maxVisible = this._maxVisibleItems || this._numberOfColumns;
        cols = Math.min(maxVisible, this._numberOfColumns);
      }

      if (this._roundRobinInsertIndex === undefined) {
        this._roundRobinInsertIndex = -1;
      }
      this._roundRobinInsertIndex++;
      this._roundRobinInsertIndex = this._roundRobinInsertIndex % cols;
      return this._roundRobinInsertIndex;
    },
    shortestColumn: function (contentView, forcedIndex) {
      if (this._shortestColInsertIndex === undefined) {
        this._shortestColInsertIndex = 0;
      }
      var newContentViewIndex = forcedIndex || this.views.indexOf(contentView);
      if (newContentViewIndex === 0 || this.views.length <= this._columnViews.length) {
        return MediaWallView.columnPickers.roundRobin.apply(this, arguments);
      }

      var targetColIndex = this._shortestColInsertIndex;
      var shortestHeight;
      for (var i = 0; i < this._columnViews.length; i++) {
        var colHeight = this._columnHeights[i];

        if (shortestHeight === undefined) {
          shortestHeight = colHeight;
          targetColIndex = i;
          continue;
        }

        if (colHeight < shortestHeight) {
          shortestHeight = colHeight;
          targetColIndex = i;
        } else if (colHeight === shortestHeight) {
          break;
        }
      }

      targetColIndex = targetColIndex >= this._columnViews.length ? 0 : targetColIndex;
      this._shortestColInsertIndex = targetColIndex;
      return targetColIndex;
    }
  };

  MediaWallView.prototype.events = ContentListView.prototype.events.extended({
    'imageLoaded.hub': function (e, opts) {
      opts = opts || {};
      for (var i = 0; i < this._columnViews.length; i++) {
        if (opts.contentView && this._columnViews[i].views.indexOf(opts.contentView) > -1) {
          this._columnHeights[i] = this._columnViews[i].$el.height();
          break;
        }
      }
    }
  });

  /**
   * Gets the style element associated with this instance of MediaWallView
   * @returns {HTMLElement} The style element for this MediaWallView
   */
  MediaWallView.prototype._getWallStyleEl = function () {
    var $wallStyleEl = $('#wall-style-' + this._id);
    if ($wallStyleEl) {
      return $wallStyleEl;
    }
  };

  /**
   * Sets the column width in the style element for this MediaWallView
   * instance.
   * @returns {Number} The width of the column in pixels
   */
  MediaWallView.prototype._setColumnWidth = function (width) {
    var $wallStyleEl = this._getWallStyleEl();
    if ($wallStyleEl) {
      $wallStyleEl.remove();
    }
    var wallCss = '.streamhub-media-wall-' + this._id + ' .hub-wall-column { width: ' + width + '; }';
    $wallStyleEl = $('<style id="wall-style-' + this._id + '">' + wallCss + '</style>');
    $wallStyleEl.appendTo('head');
    return this._getColumnWidth();
  };

  /**
   * Gets the column width
   * @returns {Number} The width of the column in pixels
   */
  MediaWallView.prototype._getColumnWidth = function () {
    var $contentContainerEl = this.$el && this.$el.find('.' + this.columnClassName);
    if ($contentContainerEl && $contentContainerEl.length) {
      this._columnWidth = $contentContainerEl[0].getBoundingClientRect().width;
      return this._columnWidth;
    }
    return 0;
  };

  /**
   * Set the element that this ContentListView renders in
   * @param element {HTMLElement} The element to render the ContentListView in
   */
  MediaWallView.prototype.setElement = function (el) {
    var prevEl = this.el;
    ContentListView.prototype.setElement.call(this, el);
    this.$el
      .addClass(this.mediaWallClassName)
      .addClass('streamhub-media-wall-' + this._id);

    if (this._constrainAttachmentsByWidth) {
      this.$el.addClass(this.fitToWidthClassName);
    }

    // If you're changing to a new element, it could have diff dimensions
    // and thus need a diff number of columns
    if (prevEl && this._autoFitColumns) {
      this.fitColumns();
    }
  };

  /**
   * Overrides the `createContentView` function to create a content view with
   * additional params:
   *   `productOptions` enables the product conversion functionality.
   *   `spectrum` enables a new style design for the cards.
   * @param {Content} content Object to create a corresponding view for.
   * @returns {ContentView} Content view object for the given piece of content.
   * @override
   */
  MediaWallView.prototype.createContentView = function (content) {
    return this.contentViewFactory.createContentView(content, {
      doNotTrack: this.opts.doNotTrack,
      hideSocialBrandingWithRights: this.opts.hideSocialBrandingWithRights,
      liker: this._liker,
      productOptions: this.opts.productOptions,
      sharer: this._sharer,
      showCTA: this.opts.showCTA,
      spectrum: true
    });
  };

  /**
   * Render the MediaWallView
   */
  MediaWallView.prototype.render = function () {
    if (this._autoFitColumns) {
      this.fitColumns();
    }

    ContentListView.prototype.render.call(this);

    var columnView;
    // then render the columns
    if (this._columnViews.length !== this._numberOfColumns) {
      while (this._columnViews.length < this._numberOfColumns) {
        columnView = this._createColumnView();
        this._attachColumnView(columnView);
        columnView.render();
      }
    } else {
      for (var i = 0; i < this._columnViews.length; i++) {
        this._attachColumnView(this._columnViews[i]);
      }
    }
  };

  /**
   * Determines the number columns based on the configured #_contentWidth.
   * @param opts {Object}
   */
  MediaWallView.prototype.fitColumns = function (opts) {
    if (this._containerInnerWidth === this.$el.innerWidth()) {
      return;
    }
    var latestWidth = this.$el.innerWidth();
    // If width hasn't changed, do nothing
    if (latestWidth === this._containerInnerWidth) {
      return;
    }

    this._containerInnerWidth = latestWidth;
    var numColumns = parseInt(this._containerInnerWidth / this._contentWidth, 10);
    // Always set to at least one column
    return this.setColumns(numColumns || 1);
  };

  /**
   * Creates a column view for the number of columns specified. Triggers
   * relayout.
   * @param numColumns {Number} The number of columns the MediaWallView should be composed of
   * @return {Boolean} Whether the number of columns is different than before
   */
  MediaWallView.prototype.setColumns = function (numColumns) {
    if (numColumns === this._numberOfColumns) {
      return;
    }
    this._numberOfColumns = numColumns;
    var $wallStyleEl = this._getWallStyleEl();
    if ($wallStyleEl) {
      $wallStyleEl.remove();
    }
    $wallStyleEl = $('<style id="wall-style-' + this._id + '"></style');
    this._setColumnWidth((100 / this._numberOfColumns) + '%');

    for (var i = 0; i < numColumns; i++) {
      if (this._columnHeights[i] === undefined) {
        this._columnHeights[i] = 0;
      }
    }

    this._moreAmount = this._moreAmount || numColumns * 2; // Show more displays 2 new rows
    return numColumns;
  };

  /**
   * Gets the number of maximum visible items for a given column view. Uses
   * ceil to ensure that the number is a positive whole number >= 1. If it
   * is a decimal, it won't show the cards properly.
   * @returns {Number} The number of maximum visible items for a given column view
   */
  MediaWallView.prototype._getMaxVisibleItemsForColumn = function () {
    return Math.ceil(this._maxVisibleItems / this._numberOfColumns);
  };

  MediaWallView.prototype._attachColumnView = function (columnView) {
    if (this._columnViews.indexOf(columnView) === -1) {
      this._columnViews.push(columnView);
    }
    this.$listEl.append(columnView.$el);
  };

  /**
   * Creates a column view and appends it into the DOM
   * @returns {View} The view representing a column in the MediaWall. Often a type of ListView.
   */
  MediaWallView.prototype._createColumnView = function () {
    if (this._columnViews.length >= this._numberOfColumns) {
      return;
    }
    var columnView = new ContentListView({
      animate: this._animate,
      autoRender: false,
      comparator: this.comparator,
      hideSocialBrandingWithRights: this.opts.hideSocialBrandingWithRights,
      maxVisibleItems: this._getMaxVisibleItemsForColumn(),
      modal: this._modal,
      stash: this.more
    });
    columnView.$el.addClass(this.columnClassName);
    return columnView;
  };

  /**
   * Removes column views from the MediaWallView
   * @param [removeContentViews=false] {Boolean} Whether to destroy
   *     the contentViews in each column, or preserve them for later
   */
  MediaWallView.prototype._clearColumns = function (removeContentViews) {
    if (!this._columnViews || !this._columnViews.length) {
      return;
    }
    for (var i = 0; i < this._columnViews.length; i++) {
      var columnView = this._columnViews[i];
      if (!removeContentViews) {
        // this will detach all the contentViews, preserving their
        // event listeners
        columnView.clear();
      }
      columnView.detach();
      columnView.destroy();
    }
    this._columnViews = [];
  };

  /**
   * Insert a contentView into the Media Wall's column ContentListViews
   * @protected
   * @param view {View} The view to add to this.el
   * @param [forcedIndex] {number} Index of the view in this.views
   */
  MediaWallView.prototype._insert = function (contentView, forcedIndex) {
    var targetColumnIndex = this._pickColumnIndex(contentView, forcedIndex);
    var targetColumnView = this._columnViews[targetColumnIndex];

    if (typeof forcedIndex === 'number') {
      forcedIndex = Math.min(
        Math.ceil(forcedIndex / this._columnViews.length),
        targetColumnView.views.length);
    }
    targetColumnView.add(contentView, forcedIndex);

    // IE8 will not automatically push the 'show more' button down as the
    // wall grows. Adding and removing a random class will force a repaint
    var randomClass = String(Math.floor(Math.random()));
    this.$el.addClass(randomClass);
    this.$el.removeClass(randomClass);
    this._columnHeights[targetColumnIndex] = targetColumnView.$el.height();
  };

  /**
   * Relayout the items in the Wall.
   * If called with no arguments, and the wall was not constructed with a
   * specific number of columns, it will redetect an appropriate number given
   * this.el's width
   * @param [opts] Options
   * @param [opts.columns] Force a specific new number of columns. Once you do
   *   this, the wall will no longer automatically detect an appropriate number
   *   of columns on window resize
   */
  MediaWallView.prototype.relayout = function (opts) {
    opts = opts || {};
    if (opts.columns) {
      this._autoFitColumns = false;
      this.setColumns(opts.columns);
    } else if (opts.columns === null) {
      this._autoFitColumns = true;
      this.fitColumns();
    } else if (this._autoFitColumns) {
      this.fitColumns();
    }

    var i;
    this._clearColumns();
    for (i = 0; i < this._numberOfColumns; i++) {
      var columnView = this._createColumnView();
      this._attachColumnView(columnView);
      columnView.render();
    }

    // Reset column insert state
    for (i = 0; i < this._columnViews.length; i++) {
      this._columnHeights[i] = 0;
    }
    this._roundRobinInsertIndex = -1;

    // Re-insert all content views
    for (i = 0; i < this.views.length; i++) {
      var contentView = this.views[i];
      var index = this._isIndexedView(contentView) ? i : undefined;
      this._insert(contentView, index);
    }
  };

  /**
   * Show More content.
   * ContentListView keeps track of an internal ._newContentGoal
   *     which is how many more items he wishes he had.
   *     This increases that goal and marks the Writable
   *     side of ContentListView as ready for more writes.
   * @param numToShow {number} The number of items to try to add
   */
  MediaWallView.prototype.showMore = function (numToShow) {
    // When fetching more content from the archive, remove the bounded
    // visible limit
    for (var i = 0; i < this._columnViews.length; i++) {
      this._columnViews[i].bounded(false);
    }
    ContentListView.prototype.showMore.call(this, numToShow);
  };

  /**
   * Remove a content model or its view from the MediaWall.
   * It removes the view from this.views[] and also calls remove() on the view,
   * which fires an event so that the columnView also removes a reference.
   * @param content {Content|ContentView} the item to remove
   * @override
   */
  MediaWallView.prototype.remove = function (content) {
    var contentView = content && content.el ? content : this.getContentView(content);
    // Should fire an event to containing views and also detach the
    // .el from the dom
    contentView.remove();
    return ContentListView.prototype.remove.apply(this, arguments);
  };

  /**
   * Returns a function, that, as long as it continues to be invoked, will not be triggered.
   * The function will be called after it stops being called for N milliseconds.
   * Copied from Underscore.js (MIT License) http://underscorejs.org/docs/underscore.html#section-65
   * @param func {function} The function to debounce
   * @param wait {number} The number of milliseconds to wait for execution of func
   * @param immediate {boolean} trigger the function on the leading edge, instead of the trailing.
   * @return {function} A debounced version of the passed `func`
   */
  function debounce(func, wait, immediate) {
    var timeout, result;
    return function () {
      var context = this,
        args = arguments;
      var later = function () {
        timeout = null;
        if (!immediate) {
          result = func.apply(context, args);
        }
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) {
        result = func.apply(context, args);
      }
      return result;
    };
  }

  /**
   * Call this when the MediaWallView is no longer needed to clean up
   * event listeners and memory.
   */
  MediaWallView.prototype.destroy = function () {
    $(window).off('resize', this._onWindowResize);
    this._clearColumns(true);
    this._columnViews = [];
    ContentListView.prototype.destroy.call(this);
  };

  return MediaWallView;
});
