(function() {
    const log       = require("ko/logging").getLogger("commando-scope-files");
    const commando  = require("commando/commando");
    const {Cc, Ci}  = require("chrome");
    const system    = require("sdk/system");
    const ioFile    = require("ko/file");
    const $         = require("ko/dom");
    const sdkUrl    = require("sdk/url");
    const patIO     = require("sdk/fs/path");
    const sep       = system.platform == "winnt" ? "\\" : "/";
    const isep      = sep == "/" ? /\\/g : /\//g;
    const pathsep   = system.platform == "winnt" ? ":" : ";";
    const w         = require("ko/windows").getMain();

    const scope     = Cc["@activestate.com/commando/koScopeFiles;1"].getService(Ci.koIScopeFiles);
    const partSvc   = Cc["@activestate.com/koPartService;1"].getService(Ci.koIPartService);
    const ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
    const prefs     = require("ko/prefs");

    //log.setLevel(require("ko/logging").LOG_DEBUG);
    var activeUuid = null;

    var ko    = w.ko;
    var local = {warned: {}};

    var init = function()
    {
        $(window).on("folder_touched", require("contrib/underscore").debounce(function(e)
        {
            scope.deleteCachePath(e.detail.path);

            if (commando.getScope().handler == "scope-files/files")
            {
                commando.reSearch();
                if (commando.isOpen()) commando.focus();
            }
        }, 100));
    };

    // Shortcut cache variables.
    var shortcutsVersion = -1;
    var shortcutsCache = {};
    
    this.clearShortcutCache = function()
    {
        shortcutsVersion = -1;
    }

    var getShortcuts = function()
    {
        // Reload shortcuts when a change is detected.
        var koDoc = ko.views.manager.currentView ? ko.views.manager.currentView.koDoc || {} : {};
        var koFile = koDoc.file || {};
        var scopeVersion = scope.shortcutsVersion + (koFile.path || "");
        var isRemote = false;
        if (shortcutsVersion != scopeVersion) {
            log.debug("Updating shortcut cache");

            try
            {
                shortcutsCache = JSON.parse(scope.getShortcutsAsJson());
            } catch (e)
            {
                log.exception(e);
                shortcutsCache = {};
            }
            shortcutsVersion = scopeVersion;

            var spref = prefs.getPref("scope-files-shortcuts");

            for (let x=0;x<spref.length;x++)
            {
                let [shortcut, path] = spref.getString(x).split(":");
                shortcutsCache[shortcut] = path;
            }

            if ("baseName" in koFile)
            {
                log.debug("Including koDoc.file shorcuts");
                shortcutsCache["%d"] = ioFile.basename(koFile.dirName);
                shortcutsCache["%D"] = koFile.dirName;
            }

            var curProject = partSvc.currentProject;
            var projectLiveD = curProject.liveDirectory;
            
            if (/(^ftp|^sftp|ftps)/.test(projectLiveD)) {
                var projectUrl = curProject.url,
                projectPath = patIO.dirname(projectUrl);
                
                isRemote = true;
                    
                projectLiveD = ko.uriparse.URIToLocalPath(projectPath);
            }
            
            if (curProject)
            {
                log.debug("Including curProject shorcuts");
                shortcutsCache["%i"] = projectLiveD;
                shortcutsCache["%P"] = ko.uriparse.URIToLocalPath(curProject.url);
            }

            shortcutsCache["%w"] = isRemote ? (ko.places.getDirectory()) : ko.uriparse.URIToLocalPath(ko.places.getDirectory());
        }

        if ( ! "observing" in getShortcuts)
        {
            log.debug("Adding shortcut pref observer");

            getShortcuts.observing = true;

            prefs.onChange("scope-files-shortcuts", function()
            {
                shortcutsVersion = -1;
            });
        }

        return shortcutsCache;
    }

    var parsePaths = function(query, subscope, opts)
    {
        query = query.replace(isep, sep); // force os native path separators
        opts["explicit"] = false;

        log.debug("Parsing paths for query: " + query + ", and path: " + subscope.path);
        
        if (query == "") return [query, subscope, opts];
        
        var _query = query.split(sep); // Convert query to array (split by path separators)
        var recursive = _query.length >= 1 ? !! _query.slice(-1)[0].match(/^\s/) : false;
        var isRemote = false;
        
        // Shortcuts
        if (opts["allowShortcuts"]) {
            var shortcuts = getShortcuts();
            if (query.match(/^[\w~%_\-]+(?:\/|\\)/) && (_query[0] in shortcuts))
            {
                log.debug("Running query against shortcuts");
    
                query = query.replace(_query[0], shortcuts[_query[0]]);
                opts["allowShortcuts"] = false;
                opts["cacheable"] = false;
                opts["explicit"] = true;
                return parsePaths(query, subscope, opts);
            }
        }

        // Absolute paths
        var dirname = _dirname(query);
        var view = ko.views.manager.currentView;
        if (query.indexOf(sep) !== -1 && (_ioFile("exists", query) || _ioFile("exists", dirname)))
        {
            log.debug("Query is absolute");

            opts["recursive"] = recursive;
            opts["fullpath"] = true;
            opts["cacheable"] = false;
            opts["explicit"] = true;
            subscope.name = "";

            if (query.substr(-1) == sep)
            {
                subscope.path = query;
                query = "";
            }
            else
            {
                subscope.path = dirname;
                query = ioFile.basename(query);
            }
            
            if (subscope.path.substr(-1) != sep) 
                subscope.path = subscope.path + sep
                
            return [query, subscope, opts];
        }
        
        // Relative paths
        else if (view && view.koDoc && view.koDoc.file)
        {
            var isRelative = query.substr(0,2) == ("." + sep) || query.substr(0,3) == (".." + sep);
            var curProject = partSvc.currentProject;
            var projectLiveD = curProject.liveDirectory;
            
            if (/(^ftp|^sftp|ftps)/.test(projectLiveD)) {
                isRemote = true;
                var projectUrl = curProject.url,
                projectPath = patIO.dirname(projectUrl);
                    
                    projectLiveD = projectPath;
                    projectLiveD = ko.uriparse.URIToLocalPath(projectPath);
            }
            
            if (curProject)
            {
                log.debug("Including curProject shorcuts");
                shortcutsCache["%i"] = projectLiveD;
                shortcutsCache["%P"] = ko.uriparse.URIToLocalPath(curProject.url);
            }
            
            shortcutsCache["%w"] = isRemote ? patIO.dirname(ko.places.getDirectory()) : sdkUrl.URL(ko.places.getDirectory()).path;
            var curProject = partSvc.currentProject;
            
            var cwd = curProject ? projectLiveD : ko.uriparse.URIToPath(ko.places.getDirectory());
            if (opts["relativeFromCurrentView"]) {
                cwd = view.koDoc.file.dirName;
            }
            var relativePath = cwd + sep + query;
            dirname = _dirname(relativePath);
            if (isRelative && (_ioFile("exists", relativePath) || _ioFile("exists", dirname)))
            {
                log.debug("Query is relative");

                opts["recursive"] = recursive;
                opts["fullpath"] = true;
                opts["cacheable"] = false;
                opts["explicit"] = true;
                subscope.name = "";

                if (query.substr(-1) == sep)
                {
                    subscope.path = relativePath;
                    query = "";
                }
                else
                {
                    subscope.path = dirname;
                    query = ioFile.basename(relativePath);
                }

                if (subscope.path.substr(-1) != sep)
                    subscope.path = subscope.path + sep
            }
        }

        return [query, subscope, opts]
    }

    // Call ioFile and return false instead of exceptions
    var _ioFile = function(fn)
    {
        try
        {
            return ioFile[fn].apply(ioFile, Array.prototype.slice.call(arguments, 1));
        }
        catch (e)
        {
            return false;
        }
    }
    
    var _basename = function(str)
    {
        return str.split(sep).pop();
    }
    
    var _dirname = function(str)
    {
        str = str.split(sep);
        str.pop();
        return str.join(sep);
    }

    this.prepare = function()
    {
        var opts = {};
        var curProject = partSvc.currentProject;
        if (curProject)
        {
            // hier
            var path = curProject.liveDirectory;
            opts["excludes"] = curProject.prefset.getString("import_exclude_matches");
            opts["includes"] = curProject.prefset.getString("import_include_matches");

            opts["excludes"] = opts["excludes"] == "" ? [] : opts["excludes"].split(";");
            opts["includes"] = opts["includes"] == "" ? [] : opts["includes"].split(";");
            opts["cacheable"] = true;
        }
        else
        {
            return;
        }
        
        log.debug("Prepare - Path: "+ path +", Opts: " + JSON.stringify(opts));

        scope.buildCache(path, JSON.stringify(opts));
    }

    this.onSearch = function(query, uuid, onComplete)
    {
        log.debug(uuid + " - Starting Scoped Search");

        activeUuid = uuid;

        var opts = {
            "maxresults": ko.prefs.getLong("commando_search_max_results"),
            "allowShortcuts": ko.prefs.getBoolean("commando_allow_shortcuts", true),
            "relativeFromCurrentView": ko.prefs.getBoolean("commando_relative_from_currentview", false),
            "recursive": true,
            "usecache": true,
            "cacheable": true
        }

        // Detect directory to search in
        var paths = [];
        var curProject = partSvc.currentProject;
        var subscope = commando.getSubscope();
        var isInSubscope = !! subscope;
        if ( ! subscope && curProject)
        {
            var scopeDir = curProject.liveDirectory;
            if (/(^ftp|^sftp|ftps)/.test(curProject.liveDirectory)) {
                var projectLiveD = curProject.liveDirectory,
                projectUrl = curProject.url,
                projectPath = patIO.dirname(projectUrl);
                
                    
                scopeDir = ko.uriparse.URIToLocalPath(projectPath);
            }
            subscope = {name: curProject.name.split(".")[0], path: scopeDir};
        }
        else if ( ! subscope)
        {
            if ( ! ko.places || ! ko.places.manager)
            {
                log.warn("ko.places(.manager) has not yet been initialized, delaying search");
                return setTimeout(this.onSearch.bind(this, query, uuid, onComplete), 200);
            }
            
            var placesPath = ko.uriparse.URIToPath(ko.places.getDirectory());
            subscope = {name: ioFile.basename(placesPath), path: placesPath};
        }
        else
        {
            subscope.path = subscope.data.path;
            opts["cacheable"] = false;
        }

        [query, subscope, opts] = parsePaths(query, subscope, opts);

        if (query == "")
            opts["recursive"] = false;

        if ( ! opts['recursive'])
            opts["usecache"] = false;
            
        // Add live folders
        if ( ! opts["explicit"] && ! isInSubscope && curProject)
        {
            let length = {}, children = {};
            curProject.getChildren(children, length);
            if (length.value)
            {
                for (let i=0;i<length.value;i++)
                {
                    let child = children.value[i];
                    if (child.type == "livefolder")
                    {
                        try
                        {
                            let folderPath = ko.uriparse.URIToLocalPath(child.url);
                            paths.push(folderPath);
                        }
                        catch (e)
                        {
                            log.debug("Not adding non-local folder path: " + child.url);
                        }
                    }
                }
            }
        }

        // Set includes/excludes.
        var opts_prefs = ((curProject && subscope.path.indexOf(curProject.liveDirectory) === 0) ?
                          curProject.prefset :
                          prefs);
        opts["excludes"] = opts_prefs.getString("import_exclude_matches");
        opts["includes"] = opts_prefs.getString("import_include_matches");

        opts["excludes"] = opts["excludes"] == "" ? [] : opts["excludes"].split(";");
        opts["includes"] = opts["includes"] == "" ? [] : opts["includes"].split(";");

        opts["weightMatch"] = prefs.getBoolean('commando_files_weight_multiplier_match', 30);
        opts["weightHits"] = prefs.getBoolean('commando_files_weight_multiplier_hits', 20);
        opts["weightDepth"] = prefs.getBoolean('commando_files_weight_multiplier_depth', 10);
        
        paths.unshift(subscope.path);

        var _opts = JSON.stringify(opts);
        log.debug(uuid + " - Query: "+ query +", Paths: "+ paths.join(" : ") + ", Opts: " + _opts);

        scope.search(query, uuid, paths.join(","), _opts, function(status, results)
        {
            if (activeUuid != uuid)
            {
                if ( ! (uuid in local.warned))
                {
                    log.debug(uuid + " - No longer the active search, don't pass result");
                    local.warned[uuid] = true;
                }
                return; // Don't waste any more time on past search queries
            }

            if (results == "done") // search complete
            {
                // Since python is multi-threaded, results might still be processed
                // Todo: find proper solution
                onComplete();
                return;
            }

            var folderIcon = "koicon://ko-svg/chrome/fontawesome/skin/folder.svg?size=16";

            var _results = [];
            var encodeURIComponent = window.encodeURIComponent;
            for (let x in results)
            {
                let entry = results[x];

                var [name, path, type, descriptionPrefix, description, weight] = entry;

                _results.push({
                    id: path,
                    name: name,
                    description: description,
                    icon: type == 'dir' ? folderIcon : "koicon://" + encodeURIComponent(name) + "?size=14",
                    isScope: type == 'dir',
                    classList: type == 'dir' ? "" : "small-icon",
                    weight: weight,
                    scope: "scope-files",
                    descriptionPrefix: isInSubscope ? subscope.name : descriptionPrefix,
                    data: {
                        path: path,
                        type: type
                    },
                    allowMultiSelect: type != 'dir'
                });
            }

            commando.renderResults(_results, uuid);
        });
    }

    this.sort = function(current, previous)
    {
        if ( ! current || ! previous) return 0;
        return previous.name.localeCompare(current.name) > 0 ? 1 : -1;
    }

    this.onSelectResult = function(selectedItems)
    {
        log.debug("Opening Files");

        var uris = []
        for (let item in selectedItems)
        {
            item = selectedItems[item];
            var URI = item.resultData.data.path;
            var isRemote = false;
            
            
            var currentProject = ko.projects.manager.currentProject;
            if (currentProject) {
                var projectLiveD = currentProject.liveDirectory,
                    projectUrl = currentProject.url,
                    projectPath = ko.uriparse.displayPath(patIO.dirname(projectUrl)),
                    projectPathParsed = require("sdk/url").URL(projectPath).toLowerCase(),
                    displayPath = URI,
                    displayPathParsed = require("sdk/url").URL(displayPath).toLowerCase();
                    
                if (displayPathParsed.indexOf(projectPathParsed) !== -1) {
                    if (/(^ftp|^sftp|ftps)/.test(projectLiveD)) {
                        var remoteMirrorUrl = projectLiveD + displayPath.substr(projectPath.length, displayPath.length),
                            parseddUrl = ko.uriparse.displayPath(remoteMirrorUrl).replace(/\\/g, '/'); // Win fix
                       URI = parseddUrl;
                       isRemote = true;
                    }
                }
			}
            
            // Todo be a bit more intelligent
            // TODO naar remote als in remote
            uris.push((isRemote ? URI : ko.uriparse.pathToURI(URI)));
        }

        log.debug("Opening files: " + uris.join(", "));

        if (uris.length === 1)
            ko.open.URI(uris[0]);
        else
            ko.open.multipleURIs(uris);

        commando.hideCommando();
    }

    this.onExpandSearch = function(query, uuid, callback)
    {
        var commands = require("./commands");
        commands.onSearch(query, uuid, callback);
    }

    this.clearCache = function()
    {
        scope.emptyCache();
    }

    init();

}).apply(module.exports);
