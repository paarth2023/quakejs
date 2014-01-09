var DirectedGraph = require('./directed-graph');
var qkfiles = require('quakejs-files');
var path = require('path');

var ASSET = {
	AUDIO:   0,
	MAP:     1,
	BOT:     2,
	MODEL:   3,
	SCRIPT:  4,
	SHADER:  5,
	SKIN:    6,
	TEXTURE: 7,
	MISC:    8
};

function sanitize(p) {
	return p.toLowerCase().replace(/\\/g, '/');
}

function generalize(p, type) {
	var newExt;

	switch (type) {
		case ASSET.AUDIO:
			newExt = '.audio';
			break;
		case ASSET.MAP:
			newExt = '.map';
			break;
		case ASSET.BOT:
			newExt = '.bot';
			break;
		case ASSET.MODEL:
			newExt = '.model';
			break;
		case ASSET.SCRIPT:
			newExt = '.script';
			break;
		case ASSET.SHADER:
			newExt = '.shader';
			break;
		case ASSET.SKIN:
			newExt = '.skin';
			break;
		case ASSET.TEXTURE:
			newExt = '.texture';
			break;
	}

	if (newExt) {
		var ext = path.extname(p);
		p = ext ? p.replace(ext, newExt) : (p + newExt);
	}

	return p;
}

var AssetGraph = function (baseGame) {
	this.baseGame = baseGame;

	DirectedGraph.call(this);
};

AssetGraph.prototype = Object.create(DirectedGraph.prototype);

AssetGraph.ASSET = ASSET;
AssetGraph.prototype.ASSET = ASSET;

AssetGraph.prototype._key = function (name, game, type) {
	return game + '/' + generalize(sanitize(name), type);
}

AssetGraph.prototype._getAsset = function (name, game, type) {
	var key = this._key(name, game, type);

	return this.getVertex(key);
}

AssetGraph.prototype._addAsset = function (name, game, type) {
	var self = this;
	var isMod = game !== this.baseGame;
	var key = this._key(name, game, type);
	var v = this.getVertex(key);

	if (!v) {
		v = this.addVertex(key, { game: game, type: type });

		// if there is a vertex with the same name in the base game, we
		// need to check if it had any relations with assets for this game
		// and update them to point to the new vertex at this time
		if (isMod) {
			var baseKey = this._key(name, this.baseGame, type);
			var baseV = this.getVertex(baseKey);

			if (baseV) {
				var removeE = [];

				baseV.inEdges.forEach(function (inE) {
					var outV = inE.outVertex;

					if (outV.data.game === game) {
						self.addEdge(outV, v);

						removeE.push(inE);
					}
				});

				baseV.outEdges.forEach(function (outE) {
					var inV = outE.inVertex;

					if (inV.data.game === game) {
						self.addEdge(v, inV);

						removeE.push(inE);
					}
				});

				removeE.forEach(function (e) { 
					self.removeEdge(e);
				});
			}
		}

		// by default, assets treat shader entries as textures. if we're
		// adding a shader with the same name, we need to update any
		// of these relationships (as shaders take precedence)
		if (type === ASSET.SHADER) {
			var games = isMod ? [game, this.baseGame] : [this.baseGame];

			games.forEach(function (textureGame) {
				var textureKey = self._key(name, textureGame, ASSET.TEXTURE);
				var textureV = self.getVertex(textureKey);

				if (!textureV) {
					return;
				}

				var removeE = [];

				textureV.inEdges.forEach(function (inE) {
					var outV = inE.outVertex;

					if ((outV.data.type === ASSET.MAP || outV.data.type === ASSET.MODEL) && outV.data.game === game) {
						self.addEdge(outV, v);

						removeE.push(inE);
					}
				});

				removeE.forEach(function (e) { 
					self.removeEdge(e);
				});
			});
		}
	}

	return v;
};

AssetGraph.prototype._getOrAdddAsset = function (name, game, type) {
	var v = this._getAsset(name, game, type);

	if (!v) {
		v = this._getAsset(name, this.baseGame, type);

		if (!v) {
			v = this._addAsset(name, this.baseGame, type);
		}
	}

	return v;
};

AssetGraph.prototype._getOrAddShader = function (name, game) {
	var v = this._getAsset(name, game, ASSET.SHADER);

	if (!v) {
		v = this._getAsset(name, game, ASSET.TEXTURE);

		if (!v) {
			v = this._getAsset(name, this.baseGame, ASSET.SHADER);

			if (!v) {
				v = this._addAsset(name, this.baseGame, ASSET.TEXTURE);
			}
		}
	}

	return v;
};

AssetGraph.prototype._addReference = function (a, b) {
	for (var i = 0; i < a.outEdges.length; i++) {
		if (a.outEdges[i].inVertex == b) {
			return;
		}
	}
	return this.addEdge(a, b);
};

AssetGraph.prototype.addAudio = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.AUDIO);
};

AssetGraph.prototype.addBot = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.BOT);
};

AssetGraph.prototype.addMap = function (name, game, buffer) {
	name = sanitize(name);

	var mapV = this._addAsset(name, game, ASSET.MAP);

	var map = qkfiles.bsp.load(buffer, { lumps: [qkfiles.bsp.LUMP.ENTITIES, qkfiles.bsp.LUMP.SHADERS] });

	// add reference to .aas botfile
	var aas = name.replace('.bsp', '.aas');
	this._addReference(mapV, this._getOrAdddAsset(aas, game, ASSET.BOT));

	// add reference to levelshot
	var levelshot = path.join('levelshots', path.basename(name).replace('.bsp', '.tga'));
	this._addReference(mapV, this._getOrAdddAsset(levelshot, game, ASSET.TEXTURE));

	// process entities for asset references
	for (var i = 0; i < map.entities.length; i++) {
		var ent = map.entities[i];
		var assets = [];

		if (ent.music) {
			assets.push(this._getOrAdddAsset(ent.music, game, ASSET.AUDIO));
		}

		if (ent.noise && ent.noise.charAt(0) !== '*') {
			assets.push(this._getOrAdddAsset(ent.noise, game, ASSET.AUDIO));
		}

		if (ent.model && ent.model.charAt(0) !== '*') {
			assets.push(this._getOrAdddAsset(ent.model, game, ASSET.MODEL));
		}

		if (ent.model2 && ent.model2.charAt(0) !== '*') {
			assets.push(this._getOrAdddAsset(ent.model2, game, ASSET.MODEL));
		}

		for (var j = 0; j < assets.length; j++) {
			this._addReference(mapV, assets[j]);
		}
	}

	// process shader lump for textures
	for (var i = 0; i < map.shaders.length; i++) {
		var shaderName = map.shaders[i].shaderName;

		// ignore lightmap textures
		if (shaderName.charAt(0) === '*') {
			continue;
		}

		var textureV = this._getOrAddShader(shaderName, game);
		this._addReference(mapV, textureV);
	}

	return mapV;
};

AssetGraph.prototype.addMisc = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.MISC);
};

AssetGraph.prototype.addModel = function (name, game, buffer) {
	name = sanitize(name);

	var modelV = this._addAsset(name, game, ASSET.MODEL);
	var model = qkfiles.md3.load(buffer);

	for (var i = 0; i < model.skins.length; i++) {
		var skin = model.skins[i];
		if (!skin) {
			// models often have bad data, including empty skin / shader names
			continue;
		}
		var skinV = this._getOrAdddAsset(texture, game, ASSET.SKIN);
		this._addReference(modelV, skinAsset);
	}

	for (var i = 0; i < model.surfaces.length; i++) {
		var surface = model.surfaces[i];

		for (var j = 0; j < surface.shaders.length; j++) {
			var texture = surface.shaders[j];
			if (!texture) {
				continue;
			}

			var textureV = this._getOrAddShader(texture, game);
			this._addReference(modelV, textureV);
		}
	}

	return modelV;
};

AssetGraph.prototype.addShader = function (name, game, buffer) {
	name = sanitize(name);

	var scriptV = this._addAsset(name, game, ASSET.SCRIPT);
	var script = qkfiles.shader.loadScript(buffer.toString('utf8'));

	for (var key in script) {
		if (!script.hasOwnProperty(key)) {
			continue;
		}

		// note: while scripts do contain shaders organizationally,
		// scripts are never referenced, therefor we model the
		// relationship as:
		//                             / - base_wall.shader
		// textures/base_wall/foobar -> -- textures/base_wall/foobar_stage1.tga
		//                             \ - textures/base_wall/foobar_stage2.tga
		var shaderV = this._addAsset(key, game, ASSET.SHADER);
		var shader = qkfiles.shader.loadShader(script[key]);

		this._addReference(shaderV, scriptV);

		for (var i = 0; i < shader.stages.length; i++) {
			var stage = shader.stages[i];

			for (var j = 0; j < stage.maps.length; j++) {
				var stageV = this._getOrAdddAsset(stage.maps[j], game, ASSET.TEXTURE);
				this._addReference(shaderV, stageV);
			}
		}
	}

	return scriptV;
};

AssetGraph.prototype.addSkin = function (name, game) {
	name = sanitize(name);

	// TODO parse skin asset

	return this._addAsset(name, game, ASSET.SKIN);
};

AssetGraph.prototype.addTexture = function (name, game) {
	name = sanitize(name);

	return this._addAsset(name, game, ASSET.TEXTURE);
};

AssetGraph.prototype.getMods = function () {
	var self = this;
	var mods = [];

	this.getVertices().forEach(function (v) {
		if (v.data.game === self.baseGame) {
			return;
		}
		if (mods.indexOf(v.data.game) === -1) {
			mods.push(v.data.game);
		}
	});

	return mods;
};

AssetGraph.prototype.getMaps = function (game) {
	return this.getVertices().filter(function (v) {
		return v.data.game === game && v.data.type === ASSET.MAP;
	});
};

AssetGraph.prototype._getMapReferences = function (startV, game) {
	var checked = {};
	var references = [];

	function check(v) {
		v.getInVertices().forEach(function (inV) {
			if (checked[inV.id]) {
				return;
			}
			checked[inV.id] = true;

			if (inV.data.type === AssetGraph.ASSET.MAP) {
				if ((!game || inV.data.game === game) && references.indexOf(inV) === -1) {
					references.push(inV);
				}
				return;
			}

			check(inV);
		});
	}

	check(startV);

	return references;
};

AssetGraph.prototype.getMapAssets = function (mapV, game, referenceThreshold) {
	var self = this;
	var verts = [];
	var checked = {};

	// add map as first asset
	checked[mapV.id] = true;
	verts.push(mapV);

	function check(outV) {
		if (checked[outV.id]) {
			return;
		}
		checked[outV.id] = true;

		// if the asset is unique to the mod, see how many maps for the current mod reference it,
		// if the asset is from the base directory, see how many maps from all maps it
		var isModAsset = game !== self.baseGame && outV.data.game == game;
		var references = self._getMapReferences(outV, isModAsset ? game : null);

		// if the asset is referenced by >= referenceThreshold maps, ignore it
		if (references.length >= referenceThreshold) {
			return;
		}

		// don't actually add shaders (they're not real files), we just care about their dependencies
		if (outV.data.type !== ASSET.SHADER && verts.indexOf(outV) === -1) {
			verts.push(outV);
		}

		outV.getOutVertices().forEach(check);
	}

	mapV.getOutVertices().forEach(check);

	return verts;
};

AssetGraph.prototype.getCommonAssets = function (game, whitelist, referenceThreshold) {
	var self = this;
	var verts = [];
	var checked = {};

	var isMod = game !== this.baseGame;

	function isWhitelisted(file) {
		file = file.toLowerCase();
		for (var i = 0; i < whitelist.length; i++) {
			var entry = whitelist[i];
			if (typeof entry === 'object' && entry.test(file)) {
				return true;
			} else if (typeof entry === 'string' && file.indexOf(entry) !== -1) {
				return true;
			}
		}
		return false;
	}

	function addOutRecursive(v) {
		if (checked[v.id]) {
			return;
		}
		checked[v.id] = true;

		if (v.data.type !== ASSET.SHADER && verts.indexOf(v) === -1) {
			verts.push(v);
		}

		v.getOutVertices().forEach(function (outV) {
			addOutRecursive(outV);
		});
	}

	// TODO should we ignore textures here that are only referenced by shaders and not whitelisted?

	this.getVertices().filter(function (v) {
		return v.data.game === game;
	}).forEach(function (v) {
		// if a mod directory, iterate over all assets unique to the mod, adding assets _not_ packed by a mod map
		// if the base directory, iterate over all assets unique to the mod, adding assets _not_ packed by any map
		var references = self._getMapReferences(v, isMod ? game : null);

		if (references.length < referenceThreshold && !isWhitelisted(v.id)) {
			return;
		}

		addOutRecursive(v);
	});

	return verts;
};

module.exports = AssetGraph;