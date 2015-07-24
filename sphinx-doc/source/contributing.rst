Contributing to CATMAID
=======================

CATMAID is open source software and welcomes contributions. This document
provides a brief overview of the structure of CATMAID and guidelines
contributing developers follow to help keep the codebase easy to understand and
easy to extend.

If you are considering contributing a feature to CATMAID, you can get guidance
from other active developers through the `CATMAID mailing list
<https://groups.google.com/forum/#!forum/catmaid>`_ and `GitHub repository
<https://github.com/catmaid/CATMAID>`_. Always check the `list of open issues
<https://github.com/catmaid/CATMAID/issues>`_ as there may be valuable
discussion relevant to your plans.

Before developing any features you should follow the
:doc:`basic installation instructions <installation>` to set up your development
environment.

Architecture Overview
---------------------

CATMAID is a distributed client-server application. The backend HTTP API, hosted
by the server, retrieves and stores information about projects, image stacks,
and annotations. The client frontend, which runs in the browser, provides an
interface and suite of analysis tools which interact with the backend's HTTP
API. The frontend also has its own APIs which allow new tools to be quickly
constructed or expert users to perform novel analysis using the browser console.

The backend is written primarily in Python 2.7 using the Django web framework.
Annotations and metadata about stacks are stored in a PostgreSQL database. Most
endpoints in the backend API expect and return JSON.

The frontend is written primarily in Javascript and makes use of a several
external libraries. Most interfaces are built dynamically through Javascript;
few HTML templates are used.

A core philosophy of this architecture is to keep the backend API fast and
minimal. The primary purpose of the backend is to mediate the database. Complex
analysis and data processing is performed on the client whenever possible. This
allows large scale collaboration with constrained server resources. Distributing
computation this way also exploits CATMAID's implementation choices, as modern
Javascript VMs are typically much faster than Python.

CATMAID is not an image host. Rather, the CATMAID backend provides resource,
spatial, and semantic metadata about image stacks hosted elsewhere, while the
CATMAID frontend is capable of rendering and navigating these image stacks. More
information about the types of image hosts CATMAID supports is available `on the
wiki <https://github.com/catmaid/CATMAID/wiki/Convention-for-Stack-Image-
Sources>`_ and `here <https://github.com/axtimwalde/catmaid-
tools/blob/master/README.md>`_.

Project Organization
--------------------

Code you are likely to be interested in is under the ``django`` folder in the
repository root. The sections below outline basic folder, file, and module
structure for the backend and frontend, as well as primers on a few common data
structures.

Backend
#######

All of the relevant backend code is in the ``django/applications/catmaid``
folder. Within this folder, ``models.py`` defines the database schema and
logical objects on which the back API operates, while ``urls.py`` maps URI
endpoints in the API to Python methods. Both are useful starting points when
locating particular functionality or determining where to add new functionality.

Most of the API routes to the ``catmaid.control`` module and folder. Within this
module API functions are organized into logical units like skeleton or
connector, which are grouped into corresponding Python modules. These often
contain utility functions not exposed by the API that may be useful, so when
developing a new API endpoint be sure to check related modules for reusable
utilities.

..
    TODO: organization of controls/views, urls ("Where to look and where to add")
    TODO: basic overview of schema, esp. understanding how classinstance, etc.
        relates to treenodes, connectors and tags

Frontend
########

If developing frontend functionality, a good strategy is to start by running
scripts in the browser console to quickly prototype and become familiar with
client APIs. The `scripting wiki
<https://github.com/catmaid/CATMAID/wiki/Scripting>`_ provides an introduction
to these APIs and snippets for common scripting tasks.

Javascript source files should be placed in the
``django/applications/catmaid/static/js`` folder. External libraries are located
in the ``django/applications/catmaid/static/libs`` folder, although there is
also a special CATMAID library for shared, stable components. Javascript and CSS
assets from these locations are managed by django-pipeline. When you add a
Javascript file to the ``static/js`` folder and then run::

    ./manage.py collectstatic -l

from the project folder, pipeline detects these assets, compiles and compresses
them (if configured to do so), then passes them to Django to be linked from the
configured static server directory. Assets for this pipeline are configured in
``django/projects/mysite/pipelinefiles.py``. Source files placed in
``static/js`` will be detected automatically, but any external libraries added
to the ``static/libs`` folder must also be added to ``pipelinefiles.py``.

Within the ``static/js`` folder and within the CATMAID frontend there is a
distinction between *tools* and *widgets*. A tool contains a suite of
annotations, interfaces and analyses. A widget, meanwhile, provides a single
specific interface. Most likely you are familiar with a single tool in CATMAID,
the tracing tool, but many widgets within the tracing tool, such as the 3D
viewer, connectivity widget, and selection table.

Widgets are generally prototyped objects that extend ``InstanceRegistry``, which
provides an easy means to track open instances of a particular widget. Rather
than construct their own DOM, most widgets' DOM is built by a corresponding
method in ``WindowMaker``. ``WindowMaker`` binds events from the DOM it
constructs to relevant handlers in the widget object.

..
    TODO: primer on skeletonmodels, skeletonsources, API calls via requestQueue
    TODO: trivial example on how to make a widget: where to put source, checking
        pipelinefiles, using WindowMaker, making it an instance registry, getting info
        about a skeleton, calling an API

Code Style and Conventions
--------------------------

Over the history of its development, CATMAID has accumulated a mixture of many
coding styles. To improve the consistency and clarity of code going forward, as
well as to prevent some common technical pitfalls, the core developers now
follow some simple guidelines for new code. These guidelines are relaxed and
permissive.

If modifying existing code, feel free to imitate the style of the surrounding
code if it conflicts with these guidelines.

Python
######

CATMAID does not currently adhere to a specific Python style convention like
PEP8. However, code should still follow common Python conventions and idioms
including:

* 4 spaces (not tabs) for indentation
* Maximum line length of 79 characters for comments
* Maximum line length of 120 characters for code
* `PEP8 naming conventions <https://www.python.org/dev/peps/pep-0008/#naming-conventions>`_

All new code should include docstrings that follow `PEP257
<https://www.python.org/dev/peps/pep-0257/>`_.

Javascript
##########

New code in CATMAID is styled similar to the `Google Javascript style guide
<https://google-styleguide.googlecode.com/svn/trunk/javascriptguide.xml>`_, with
notable exceptions that:

* CATMAID does not use any Google libraries
* CATMAID does not use any requirements/dependency libraries
* CATMAID uses CamelCase namespace naming

New javascript files should place all code inside an `IIFE
<http://en.wikipedia.org/wiki/Immediately-invoked_function_expression>`_ to
namespace it inside the ``CATMAID`` object and use `ES5 strict mode
<https://developer.mozilla.org/en-
US/docs/Web/JavaScript/Reference/Strict_mode>`_:

.. code-block:: javascript
    :emphasize-lines: 1,3,13

    (function (CATMAID) {

      "use strict";

      var variableNotExposedOutsideFile;

      var ClassExposedOutsideFile = function () {
        //...
      };

      CATMAID.ClassExposedOutsideFile = ClassExposedOutsideFile;

    })(CATMAID);

This prevents unintentional leaking of variables into the global scope and
possible naming conflicts with other libraries.

CATMAID makes full use of ES5 language features and allows the following ES6
features:

* `Promises <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise>`_
* `Maps <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map>`_
  and `Sets <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set>`_
  (IE11-supported ``get``, ``has``, ``set``, ``delete`` and ``forEach`` only)
* ``const`` and ``let`` declarations (in strict mode contexts only)

All features must work correctly in recent versions of Chrome and Firefox, while
core browsing features must work in IE11. Requiring polyfills for IE is
acceptable.

Git
###

Try to follow the `seven rules of great git commit messages
<http://chris.beams.io/posts/git-commit/#seven-rules>`_:

#. Separate subject from body with a blank line
#. Limit the subject line to 50 characters
#. Capitalize the subject line
#. Do not end the subject line with a period
#. Use the imperative mood in the subject line
#. Wrap the body at 72 characters
#. Use the body to explain what and why vs. how

That said, always prefer clarity over dogma. The core CATMAID contributors break
#2 frequently to keep messages descriptive (apologies to our VAX users). If a
commit focuses on a particular component or widget, prefix the commit message
with its name, such as "Selection table:" or "SVG overlay:".

Granular commits are preferred. Squashes and rollups are avoided, and rebasing
branches then fast-forwarding is preferred over merge commits when merging,
except for large feature branches.

Development occurs on the ``dev`` branch, which is merged to ``master`` when a
release is made. It is usually best to develop new features by branching from
``dev``, although critical fixes or extensions to particular releases can be
based on ``master`` or the appropriate release tag.

Never rewrite history of ``master``, ``dev``, or any other branch used by
others.

Linting and Testing
-------------------

As part of the `continuous integration build <https://travis-
ci.org/catmaid/CATMAID/branches>`_, several automated processes are performed
to help verify the correctness and quality of CATMAID:

* :doc:`Unit and integration tests for Django backend <djangounittest>`
* Linting (static analysis) of the javascript code with JSHint
* Unit tests of javascript code with QUnit

If you `enable Travis-CI for your fork of CATMAID on GitHub <http://docs.travis-
ci.com/user/getting-started/#Step-two%3A-Activate-GitHub-Webhook>`_, Travis will
run all of these checks automatically. However, Travis builds take a long time,
and you may want feedback before committing and pushing changes. Luckily all of
these checks are easy to run locally.

Django tests are run through Django's admin commands::

        cd /<path_to_catmaid_install>/django/projects/mysite
        ./manage.py test catmaid.tests

JSHint can be `installed from NPM or your platform's package manager
<http://jshint.com/install/>`_ and should use CATMAID's config settings::

    cd /<path_to_catmaid_install>
    jshint --config=.travis.jshintrc --exclude-path=.travis.jshintignore django/applications

If you do not want to configure your own JSHint settings, you can set these as
defaults::

    ln -s .travis.jshintrc .jshintrc
    ln -s .travis.jshintignore .jshintignore
    jshint django/applications

QUnit tests can be run from the browser while your Django server is running. For
example, with the default configuration this would be::

    http://localhost:8000/tests

... or, for custom configurations::

    http://<catmaid_servername>/<catmaid_subdirectory>/tests
